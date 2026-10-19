// Route tests with MOCKED providers (test-only) to exercise partial-failure behaviour.
import { describe, expect, it } from "vitest";
import { buildApp, type AppDeps } from "../src/app.js";
import type { Config } from "../src/config.js";
import type { SatelliteService, WorkerJob } from "../src/satellite.js";
import type { Place, Weather } from "../src/types.js";
import { emptyWeather } from "../src/weather.js";

const config: Config = {
  port: 0, host: "127.0.0.1", workerUrl: "http://worker", workerToken: undefined, openRouterApiKey: undefined,
  openRouterModel: "m", openRouterTimeoutMs: 1000, defaultRadiusKm: 15, maxRadiusKm: 50,
  weatherCacheTtlMs: 1000, weatherStaleAfterMs: 3 * 3600_000, corsOrigins: [], rateLimitPerMinute: 1000,
  aiRateLimitPerMinute: 1000, aiStreamIdleTimeoutMs: 1000, aiFirstTokenTimeoutMs: 1000,
};

const place: Place = {
  id: "open-meteo:1261481", city: "New Delhi", admin1: "Delhi", admin2: null, country: "India", countryCode: "IN",
  latitude: 28.63576, longitude: 77.22445, timezone: "Asia/Kolkata", population: null,
};

const goodWeather: Weather = {
  ...emptyWeather("Open-Meteo forecast API"), status: "available", validAt: new Date().toISOString(),
  fetchedAt: new Date().toISOString(), temperatureC: 33, relativeHumidityPercent: 40, apparentTemperatureC: 35,
  windSpeedKmh: 5, hourly: [],
};

const JOB = "b".repeat(32);
const LAYER = "c".repeat(24);
const completedJob: WorkerJob = {
  jobId: JOB, status: "completed",
  result: {
    status: "available", note: null, searchWindowHours: 72, productsConsidered: [], limitations: ["skin temperature"],
    layer: {
      layerId: LAYER, status: "available", productId: "S3A_SL_2_LST____X_NR_005", collectionId: "sentinel-3-sl-2-lst-nrt",
      platform: "sentinel-3a", timeliness: "NRT", acquisitionStart: new Date().toISOString(),
      acquisitionEnd: new Date().toISOString(), acquisitionTimeBasis: "granule", dayNight: "day",
      nativeResolutionMeters: 1000, boundsWgs84: [77, 28.5, 77.4, 28.8],
      coverage: { validAreaPercent: 80, validLandAreaPercent: 82, landQaPassPercent: 90, validPixelCount: 700 },
      summary: { minC: 30, meanC: 40, medianC: 41, maxC: 50, p90C: 46, areaWeighting: "equal" },
      partialSummary: null, qualityMask: {}, legend: { units: "°C" },
    },
  },
};

function satellite(overrides: Partial<SatelliteService> = {}): SatelliteService {
  return {
    submit: async () => ({ jobId: JOB, status: "processing" }),
    getJob: async () => completedJob,
    tile: async () => new Response(new Uint8Array([137, 80, 78, 71]), { status: 200 }),
    value: async () => ({ insideLayer: true, valueC: 41.2, quality: "valid" }),
    ...overrides,
  };
}

function app(over: Partial<AppDeps> = {}) {
  return buildApp({
    config,
    places: { search: async () => [place], get: async (id: string) => (id === place.id ? place : null) },
    weather: { name: "Open-Meteo forecast API", fetch: async () => goodWeather },
    wbgt: { fetch: async () => null },
    satellite: satellite(),
    ...over,
  });
}

describe("routes", () => {
  it("validates place search input", async () => {
    const a = app();
    expect((await a.inject({ url: "/api/v1/places/search?countryCode=XX&q=Delhi" })).statusCode).toBe(400);
    expect((await a.inject({ url: "/api/v1/places/search?countryCode=IN&q=D" })).statusCode).toBe(400);
    const ok = await a.inject({ url: "/api/v1/places/search?countryCode=in&q=Delhi" });
    expect(ok.statusCode).toBe(200);
    expect(ok.json().results[0].id).toBe(place.id);
  });

  it("returns 202 with weather first while satellite processes, then the combined result", async () => {
    const a = app();
    const res = await a.inject({ method: "POST", url: "/api/v1/cities/environment", payload: { placeId: place.id } });
    expect(res.statusCode).toBe(202);
    const body = res.json();
    expect(body.satellite.status).toBe("processing");
    expect(body.satellite.jobId).toBe(JOB);
    expect(body.weather.temperatureC).toBe(33);
    expect(body.advisory.classification).toBe("unclassified");
    expect(body.officialWarning.status).toBe("provider_not_configured");
    expect(body.area.label).toBe("City-centre area");

    const poll = await a.inject({ url: `/api/v1/cities/environment/${body.requestId}` });
    expect(poll.json().satellite.status).toBe("available");
    expect(poll.json().satellite.tileUrlTemplate).toBe(`/api/v1/heatmap/${LAYER}/{z}/{x}/{y}.png`);
  });

  it("weather failure does not block satellite", async () => {
    const a = app({ weather: { name: "w", fetch: async () => { throw new Error("down"); } }, satellite: satellite({ submit: async () => completedJob }) });
    const res = await a.inject({ method: "POST", url: "/api/v1/cities/environment", payload: { placeId: place.id } });
    expect(res.statusCode).toBe(200);
    expect(res.json().weather.status).toBe("error");
    expect(res.json().weather.temperatureC).toBeNull();
    expect(res.json().satellite.status).toBe("available");
    expect(res.json().advisory.classification).toBe("unknown");
  });

  it("satellite failure does not block weather", async () => {
    const a = app({ satellite: satellite({ submit: async () => { throw new Error("worker down"); } }) });
    const res = await a.inject({ method: "POST", url: "/api/v1/cities/environment", payload: { placeId: place.id } });
    expect(res.statusCode).toBe(200);
    expect(res.json().satellite.status).toBe("error");
    expect(res.json().weather.status).toBe("available");
  });

  it("rejects unknown places, bad radius and bad tile params", async () => {
    const a = app();
    expect((await a.inject({ method: "POST", url: "/api/v1/cities/environment", payload: { placeId: "open-meteo:999" } })).statusCode).toBe(404);
    expect((await a.inject({ method: "POST", url: "/api/v1/cities/environment", payload: { placeId: place.id, radiusKm: 500 } })).statusCode).toBe(400);
    expect((await a.inject({ url: `/api/v1/heatmap/../1/2/3.png` })).statusCode).toBeGreaterThanOrEqual(400);
    expect((await a.inject({ url: `/api/v1/heatmap/${LAYER}/1/2/x.png` })).statusCode).toBe(400);
  });

  it("serves tiles and numeric pixel values", async () => {
    const a = app();
    const tile = await a.inject({ url: `/api/v1/heatmap/${LAYER}/10/730/420.png` });
    expect(tile.statusCode).toBe(200);
    expect(tile.headers["content-type"]).toBe("image/png");
    const v = await a.inject({ url: `/api/v1/heatmap/${LAYER}/value?lat=28.6&lng=77.2` });
    expect(v.json().valueC).toBe(41.2);
  });

  it("advice falls back deterministically without an API key", async () => {
    const a = app();
    const res = await a.inject({ method: "POST", url: "/api/v1/cities/environment", payload: { placeId: place.id } });
    const advice = await a.inject({ url: `/api/v1/cities/environment/${res.json().requestId}/advice` });
    expect(advice.json().source).toBe("deterministic_fallback");
    expect(advice.json().classification).toBe("unclassified");
  });
});
