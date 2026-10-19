import { randomUUID } from "node:crypto";
import { PassThrough } from "node:stream";
import cors from "@fastify/cors";
import rateLimit from "@fastify/rate-limit";
import Fastify, { type FastifyInstance } from "fastify";
import { z } from "zod";
import { explain, type AdviceDeps } from "./advice.js";
import { buildAdvisory, getOfficialWarning, type OfficialWarningProvider } from "./advisory.js";
import { buildArea } from "./area.js";
import { TtlCache } from "./cache.js";
import { chatBody, streamChat, type ChatDeps } from "./chat.js";
import type { Config } from "./config.js";
import { confirmBody, confirmExistingUser, createConfirmedUser, signupBody, type AccountDeps } from "./accounts.js";
import { GibsLstService, LST_LAYERS } from "./gibs.js";
import { HeatGridService, type HeatVariable } from "./heatgrid.js";
import { HttpError } from "./http.js";
import { LiveConditionsService } from "./live.js";
import { isValidCountryCode, type PlaceService } from "./places.js";
import { emptySatellite, satelliteFromJob, type SatelliteService } from "./satellite.js";
import type {
  AiExplanation,
  Area,
  CityEnvironment,
  OfficialWarning,
  Place,
  Satellite,
  Source,
  WbgtObservation,
  Weather,
} from "./types.js";
import { emptyWeather, type NeaWbgtProvider, type WeatherProvider } from "./weather.js";

export type AppDeps = {
  config: Config;
  places: Pick<PlaceService, "search" | "get">;
  weather: WeatherProvider;
  wbgt: Pick<NeaWbgtProvider, "fetch">;
  satellite: SatelliteService;
  warningProviders?: OfficialWarningProvider[];
  advice?: Partial<AdviceDeps>;
  heatGrid?: Pick<HeatGridService, "get">;
  chat?: Partial<ChatDeps>;
  live?: Pick<LiveConditionsService, "get">;
  gibs?: Pick<GibsLstService, "latest" | "read" | "heatTile">;
  accounts?: Partial<AccountDeps>;
};

type StoredRequest = {
  requestId: string;
  place: Place;
  area: Area;
  weather: Weather;
  wbgt: WbgtObservation | null;
  officialWarning: OfficialWarning;
  jobId: string | null;
  satelliteFallback: Satellite;
  advice: Promise<AiExplanation> | null;
};

export const SOURCES: Source[] = [
  {
    id: "open-meteo-geocoding",
    name: "Open-Meteo Geocoding API",
    url: "https://open-meteo.com/en/docs/geocoding-api",
    attribution: "Location data from GeoNames (CC BY 4.0) via Open-Meteo",
    dataType: "geocoding",
  },
  {
    id: "open-meteo-forecast",
    name: "Open-Meteo Forecast API",
    url: "https://open-meteo.com/",
    attribution: "Weather data by Open-Meteo.com (CC BY 4.0)",
    dataType: "modelled weather",
  },
  {
    id: "copernicus-s3-slstr-lst",
    name: "Copernicus Sentinel-3 SLSTR Level-2 Land Surface Temperature",
    url: "https://dataspace.copernicus.eu/",
    attribution: `Contains modified Copernicus Sentinel data ${new Date().getUTCFullYear()}, processed by UrbanHeat Watch`,
    dataType: "satellite land-surface temperature",
  },
];

const NEA_SOURCE: Source = {
  id: "nea-wbgt",
  name: "NEA Wet Bulb Globe Temperature (data.gov.sg)",
  url: "https://data.gov.sg/",
  attribution: "Contains information from NEA WBGT data accessed via data.gov.sg (Singapore Open Data Licence)",
  dataType: "station observation",
};

const GLOBAL_LIMITATIONS = [
  "Weather values are numerical-model outputs for a grid cell, not readings from a local ground station.",
  "Satellite land-surface temperature is ground/roof skin temperature, not air temperature or WBGT.",
  "The UrbanHeat Watch advisory is application guidance, not an official warning.",
];

const searchQuery = z.object({
  countryCode: z.string().transform((s) => s.toUpperCase()),
  q: z.string().trim().min(2).max(100),
  language: z
    .string()
    .regex(/^[a-z]{2}$/)
    .default("en"),
});

export function buildApp(deps: AppDeps): FastifyInstance {
  const { config } = deps;
  const app = Fastify({
    logger: {
      level: process.env.LOG_LEVEL ?? "info",
      redact: ["req.headers.authorization", "req.headers['x-worker-token']"],
    },
    bodyLimit: 16 * 1024,
  });
  const requests = new TtlCache<StoredRequest>(6 * 3600_000, 5000);

  app.register(cors, { origin: config.corsOrigins });
  app.register(rateLimit, { max: config.rateLimitPerMinute, timeWindow: "1 minute" });

  app.setErrorHandler((err, req, reply) => {
    if (err instanceof HttpError) {
      req.log.warn({ source: err.source, status: err.status }, err.message);
      return reply.code(502).send({ error: "upstream_error", source: err.source, message: err.message });
    }
    const status = (err as { statusCode?: number }).statusCode ?? 500;
    if (status >= 500) req.log.error(err);
    return reply.code(status).send({
      error: status === 429 ? "rate_limited" : "error",
      message: status >= 500 ? "Internal error" : (err as Error).message,
    });
  });

  // Routes live inside a plugin so they are added after @fastify/rate-limit has loaded;
  // routes declared directly on the root instance are not seen by its onRoute hook.
  app.register(async (app) => {
    app.get("/health", async () => ({ ok: true }));

    // ------------------------------------------------------------------ places

    app.get("/api/v1/places/search", async (req, reply) => {
      const parsed = searchQuery.safeParse(req.query);
      if (!parsed.success) return reply.code(400).send({ error: "invalid_query", issues: parsed.error.issues });
      const { countryCode, q, language } = parsed.data;
      if (!isValidCountryCode(countryCode)) return reply.code(400).send({ error: "invalid_country_code" });
      const abort = new AbortController();
      req.raw.on("close", () => abort.abort());
      const results = await deps.places.search(q, countryCode, language, abort.signal);
      return { query: q, countryCode, results };
    });

    // ------------------------------------------------------------------ live conditions

    const live = deps.live ?? new LiveConditionsService();
    const liveQuery = z.object({
      lat: z.coerce.number().min(-90).max(90),
      lon: z.coerce.number().min(-180).max(180),
    });

    // ------------------------------------------------------------------ satellite land-surface temperature

    const gibs = deps.gibs ?? new GibsLstService();
    const lstQuery = z.object({
      lat: z.coerce.number().min(-85).max(85),
      lon: z.coerce.number().min(-180).max(180),
      radiusKm: z.coerce.number().min(1).max(50).default(15),
    });

    // Latest clear MODIS daytime observation around a point (NASA GIBS, no key needed).
    app.get("/api/v1/satellite/lst", async (req, reply) => {
      const parsed = lstQuery.safeParse(req.query);
      if (!parsed.success) return reply.code(400).send({ error: "invalid_query", issues: parsed.error.issues });
      const { lat, lon, radiusKm } = parsed.data;
      const res = await gibs.latest(lat, lon, radiusKm);
      if (!res) return { available: false, message: "No clear satellite observation of this area in the last month." };
      return { available: true, ...res };
    });

    // Re-coloured satellite heat tiles for the app's maps (Web Mercator, levels 0-7).
    app.get("/api/v1/satellite/tiles/:layerId/:date/:z/:x/:yPng", async (req, reply) => {
      const p = req.params as Record<string, string>;
      const y = Number(String(p.yPng).replace(/\.png$/, ""));
      const [z, x] = [Number(p.z), Number(p.x)];
      if (!(p.layerId! in LST_LAYERS) || !/^\d{4}-\d{2}-\d{2}$/.test(p.date!) || ![z, x, y].every(Number.isInteger)) {
        return reply.code(400).send({ error: "invalid_tile" });
      }
      const png = await gibs.heatTile(p.layerId!, p.date!, z, x, y);
      if (!png) return reply.code(204).send();
      return reply.header("Content-Type", "image/png").header("Cache-Control", "public, max-age=21600").send(png);
    });

    const lstPointQuery = z.object({
      lat: z.coerce.number().min(-85).max(85),
      lon: z.coerce.number().min(-180).max(180),
      layerId: z.enum(Object.keys(LST_LAYERS) as [string, ...string[]]),
      date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    });

    // The satellite value of one pixel of the layer/date shown on the map.
    app.get("/api/v1/satellite/lst/point", async (req, reply) => {
      const parsed = lstPointQuery.safeParse(req.query);
      if (!parsed.success) return reply.code(400).send({ error: "invalid_query", issues: parsed.error.issues });
      const { lat, lon, layerId, date } = parsed.data;
      const res = await gibs.read(LST_LAYERS[layerId]!, date, lat, lon, 0);
      return { lat, lon, layerId, date, valueC: res?.centerC ?? null };
    });

    app.get("/api/v1/conditions/live", async (req, reply) => {
      const parsed = liveQuery.safeParse(req.query);
      if (!parsed.success) return reply.code(400).send({ error: "invalid_query", issues: parsed.error.issues });
      const abort = new AbortController();
      req.raw.on("close", () => abort.abort());
      return live.get(parsed.data.lat, parsed.data.lon, abort.signal);
    });

    // ------------------------------------------------------------------ city environment

    const envBody = z.object({
      placeId: z.string().min(3).max(64),
      areaMode: z.literal("city-centre").default("city-centre"),
      radiusKm: z.number().min(1).max(config.maxRadiusKm).default(config.defaultRadiusKm),
    });

    app.post("/api/v1/cities/environment", async (req, reply) => {
      const parsed = envBody.safeParse(req.body ?? {});
      if (!parsed.success) return reply.code(400).send({ error: "invalid_body", issues: parsed.error.issues });
      const place = await deps.places.get(parsed.data.placeId);
      if (!place) return reply.code(404).send({ error: "place_not_found" });

      const area = buildArea(place.latitude, place.longitude, parsed.data.radiusKm);
      // Each source fails independently; partial success is the normal case.
      const [weatherR, wbgtR, jobR, warning] = await Promise.all([
        deps.weather.fetch(place).catch((e: unknown) => {
          req.log.warn({ err: (e as Error).message }, "weather failed");
          return {
            ...emptyWeather(deps.weather.name),
            status: "error" as const,
            message: "Weather provider unavailable.",
          };
        }),
        deps.wbgt.fetch(place).catch(() => null),
        deps.satellite.submit(place.latitude, place.longitude, parsed.data.radiusKm).then(
          (job) => ({ ok: true as const, job }),
          (e: unknown) => {
            req.log.warn({ err: (e as Error).message }, "satellite submit failed");
            return { ok: false as const };
          },
        ),
        getOfficialWarning(place, deps.warningProviders),
      ]);

      const stored: StoredRequest = {
        requestId: randomUUID(),
        place,
        area,
        weather: weatherR,
        wbgt: wbgtR,
        officialWarning: warning,
        jobId: jobR.ok ? jobR.job.jobId : null,
        satelliteFallback: emptySatellite("error", "Satellite processing service unavailable."),
        advice: null,
      };
      requests.set(stored.requestId, stored);
      const satellite = jobR.ok ? satelliteFromJob(jobR.job) : stored.satelliteFallback;
      const body = compose(stored, satellite);
      return reply.code(satellite.status === "processing" ? 202 : 200).send(body);
    });

    async function currentSatellite(stored: StoredRequest): Promise<Satellite> {
      if (!stored.jobId) return stored.satelliteFallback;
      try {
        return satelliteFromJob(await deps.satellite.getJob(stored.jobId));
      } catch {
        return emptySatellite("error", "Satellite processing service unavailable.", stored.jobId);
      }
    }

    const requestIdParam = z.object({ requestId: z.uuid() });

    app.get("/api/v1/cities/environment/:requestId", async (req, reply) => {
      const p = requestIdParam.safeParse(req.params);
      const stored = p.success ? requests.get(p.data.requestId) : undefined;
      if (!stored) return reply.code(404).send({ error: "request_not_found_or_expired" });
      return compose(stored, await currentSatellite(stored));
    });

    app.get("/api/v1/cities/environment/:requestId/advice", async (req, reply) => {
      const p = requestIdParam.safeParse(req.params);
      const stored = p.success ? requests.get(p.data.requestId) : undefined;
      if (!stored) return reply.code(404).send({ error: "request_not_found_or_expired" });
      const satellite = await currentSatellite(stored);
      const env = compose(stored, satellite);
      // Cache the explanation once the satellite result is final, so it is generated once.
      if (satellite.status === "processing") {
        return explain(env, adviceDeps());
      }
      stored.advice ??= explain(env, adviceDeps());
      return stored.advice;
    });

    function adviceDeps(): AdviceDeps {
      return {
        apiKey: config.openRouterApiKey,
        model: config.openRouterModel,
        timeoutMs: config.openRouterTimeoutMs,
        ...deps.advice,
      };
    }

    // ------------------------------------------------------------------ accounts

    const accountDeps = (): AccountDeps | null => {
      const supabaseUrl = deps.accounts?.supabaseUrl ?? config.supabaseUrl;
      const serviceKey = deps.accounts?.serviceKey ?? config.supabaseServiceKey;
      return supabaseUrl && serviceKey ? { supabaseUrl, serviceKey, fetchImpl: deps.accounts?.fetchImpl } : null;
    };

    app.get("/api/v1/auth/status", async () => ({ signupConfigured: accountDeps() !== null }));

    // Creates an already-confirmed account (no verification email); the app then signs in normally.
    app.post(
      "/api/v1/auth/signup",
      { config: { rateLimit: { max: config.signupRateLimitPerHour ?? 20, timeWindow: "1 hour" } } },
      async (req, reply) => {
        const acc = accountDeps();
        if (!acc) return reply.code(503).send({ error: "signup_not_configured" });
        const parsed = signupBody.safeParse(req.body ?? {});
        if (!parsed.success) {
          return reply
            .code(400)
            .send({ error: "invalid_body", message: parsed.error.issues[0]?.message ?? "Invalid input." });
        }
        const res = await createConfirmedUser(parsed.data, acc);
        if (res.status === "created") return reply.code(201).send({ created: true });
        if (res.status === "exists") return reply.code(409).send({ error: "email_exists" });
        if (res.status === "invalid") return reply.code(400).send({ error: "invalid_body", message: res.message });
        req.log.error({ message: res.message }, "signup failed");
        return reply.code(502).send({ error: "signup_failed", message: res.message });
      },
    );

    // Lets people who registered before sign-up stopped sending verification emails log in:
    // with the right password, their account is confirmed and the app signs in normally.
    app.post(
      "/api/v1/auth/confirm-existing",
      { config: { rateLimit: { max: config.signupRateLimitPerHour ?? 20, timeWindow: "1 hour" } } },
      async (req, reply) => {
        const acc = accountDeps();
        if (!acc) return reply.code(503).send({ error: "signup_not_configured" });
        const parsed = confirmBody.safeParse(req.body ?? {});
        if (!parsed.success) return reply.code(400).send({ error: "invalid_body" });
        const res = await confirmExistingUser(parsed.data, acc);
        if (res === "confirmed" || res === "already_confirmed") return { confirmed: true };
        if (res === "invalid_credentials") return reply.code(401).send({ error: "invalid_credentials" });
        req.log.error({ message: res.error }, "confirm-existing failed");
        return reply.code(502).send({ error: "confirm_failed", message: res.error });
      },
    );

    // ------------------------------------------------------------------ AI assistant chat

    app.get("/api/v1/ai/status", async () => ({ configured: Boolean(deps.chat?.apiKey ?? config.openRouterApiKey) }));

    app.post(
      "/api/v1/ai/chat",
      {
        bodyLimit: 256 * 1024,
        config: { rateLimit: { max: config.aiRateLimitPerMinute, timeWindow: "1 minute" } },
      },
      async (req, reply) => {
        const apiKey = deps.chat?.apiKey ?? config.openRouterApiKey;
        if (!apiKey) {
          return reply
            .code(503)
            .send({ error: "ai_not_configured", message: "The AI assistant is not configured on the server." });
        }
        const parsed = chatBody.safeParse(req.body ?? {});
        if (!parsed.success) return reply.code(400).send({ error: "invalid_body", issues: parsed.error.issues });

        // Stop the upstream request as soon as the app disconnects (e.g. the user presses Stop).
        const abort = new AbortController();
        reply.raw.on("close", () => {
          if (!reply.raw.writableFinished) abort.abort();
        });

        const out = new PassThrough();
        streamChat(
          parsed.data.messages,
          out,
          abort.signal,
          {
            apiKey,
            idleTimeoutMs: config.aiStreamIdleTimeoutMs,
            firstTokenTimeoutMs: config.aiFirstTokenTimeoutMs,
            ...deps.chat,
          },
          parsed.data.language,
        ).catch((err: unknown) => {
          req.log.error(err, "ai chat stream failed");
          if (!out.writableEnded) out.end();
        });

        return reply
          .header("Content-Type", "text/event-stream; charset=utf-8")
          .header("Cache-Control", "no-cache, no-transform")
          .header("X-Accel-Buffering", "no")
          .send(out);
      },
    );

    // ------------------------------------------------------------------ forecast heat grid

    const heatGrid = deps.heatGrid ?? new HeatGridService();
    const gridQuery = z.object({
      countryCode: z
        .string()
        .regex(/^[A-Za-z]{2}$/)
        .transform((s) => s.toUpperCase()),
      variable: z.enum(["temperature_2m", "apparent_temperature"]).default("temperature_2m"),
    });

    app.get("/api/v1/heatgrid", async (req, reply) => {
      const q = gridQuery.safeParse(req.query);
      if (!q.success) return reply.code(400).send({ error: "invalid_query" });
      const grid = await heatGrid.get(q.data.countryCode, q.data.variable as HeatVariable);
      if (!grid) return reply.code(404).send({ error: "country_not_supported" });
      return grid;
    });

    // ------------------------------------------------------------------ jobs and tiles

    app.get("/api/v1/jobs/:jobId", async (req, reply) => {
      const { jobId } = req.params as { jobId: string };
      if (!/^[a-f0-9]{32}$/.test(jobId)) return reply.code(400).send({ error: "invalid_job_id" });
      const job = await deps.satellite.getJob(jobId);
      return { jobId: job.jobId, status: job.status, updatedAt: job.updatedAt ?? null, error: job.error ?? null };
    });

    const layerId = z.string().regex(/^[a-f0-9]{24}$/);

    app.get("/api/v1/heatmap/:layerId/:z/:x/:yPng", async (req, reply) => {
      const params = req.params as Record<string, string>;
      const m = /^(\d+)\.png$/.exec(params.yPng ?? "");
      const z_ = Number(params.z);
      const x = Number(params.x);
      if (!layerId.safeParse(params.layerId).success || !m || !Number.isInteger(z_) || !Number.isInteger(x)) {
        return reply.code(400).send({ error: "invalid_tile" });
      }
      const res = await deps.satellite.tile(params.layerId!, z_, x, Number(m[1]));
      if (!res.ok) return reply.code(res.status === 404 ? 404 : 502).send({ error: "tile_unavailable" });
      return reply
        .header("Content-Type", "image/png")
        .header("Cache-Control", "public, max-age=86400, immutable")
        .send(Buffer.from(await res.arrayBuffer()));
    });

    const valueQuery = z.object({ lat: z.coerce.number().min(-90).max(90), lng: z.coerce.number().min(-180).max(180) });

    app.get("/api/v1/heatmap/:layerId/value", async (req, reply) => {
      const { layerId: id } = req.params as { layerId: string };
      const q = valueQuery.safeParse(req.query);
      if (!layerId.safeParse(id).success || !q.success) return reply.code(400).send({ error: "invalid_query" });
      return deps.satellite.value(id, q.data.lat, q.data.lng);
    });
  });

  return app;
}

export function compose(stored: StoredRequest, satellite: Satellite): CityEnvironment {
  const advisory = buildAdvisory(stored.place, stored.weather, stored.wbgt);
  return {
    requestId: stored.requestId,
    place: stored.place,
    area: stored.area,
    weather: stored.weather,
    wbgt: stored.wbgt,
    satellite,
    officialWarning: stored.officialWarning,
    advisory,
    aiExplanation: null,
    sources: stored.wbgt ? [...SOURCES, NEA_SOURCE] : SOURCES,
    limitations: GLOBAL_LIMITATIONS,
  };
}
