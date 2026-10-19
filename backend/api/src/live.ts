import { z } from "zod";
import { TtlCache } from "./cache.js";
import { fetchJson } from "./http.js";
import { haversineKm } from "./weather.js";

// Live "right now" conditions for the Home screen. Prefers real station observations
// over model output: NEA's 1-minute network in Singapore, then the nearest airport
// METAR, and only then Open-Meteo's modelled current conditions (labelled as such).

export type LiveConditions = {
  temperatureC: number;
  relativeHumidityPercent: number;
  observedAt: string; // UTC ISO
  kind: "station" | "model";
  source: string;
  stationName: string | null;
  distanceKm: number | null;
};

const NEA_TEMP_URL = "https://api-open.data.gov.sg/v2/real-time/api/air-temperature";
const NEA_RH_URL = "https://api-open.data.gov.sg/v2/real-time/api/relative-humidity";
const NEA_MAX_KM = 15;
const NEA_MAX_AGE_MS = 30 * 60_000;
const METAR_MAX_KM = 50;
const METAR_MAX_AGE_MS = 2 * 3600_000;

const neaResponse = z.object({
  data: z.object({
    stations: z.array(
      z.object({
        id: z.string(),
        name: z.string(),
        location: z.object({ latitude: z.number(), longitude: z.number() }),
      }),
    ),
    readings: z.array(
      z.object({
        timestamp: z.string(),
        data: z.array(z.object({ stationId: z.string(), value: z.number() })),
      }),
    ),
  }),
});
type NeaResponse = z.infer<typeof neaResponse>;

const metarResponse = z.array(
  z.object({
    icaoId: z.string(),
    name: z.string().nullish(),
    obsTime: z.number(),
    temp: z.number().nullish(),
    dewp: z.number().nullish(),
    lat: z.number(),
    lon: z.number(),
  }),
);
type Metar = z.infer<typeof metarResponse>[number];

const openMeteoCurrent = z.object({
  utc_offset_seconds: z.number(),
  current: z.object({
    time: z.string(),
    temperature_2m: z.number().nullable(),
    relative_humidity_2m: z.number().nullable(),
  }),
});

/** Relative humidity (%) from air temperature and dew point (Magnus formula). */
export function humidityFromDewPoint(tempC: number, dewPointC: number): number {
  const e = (t: number) => Math.exp((17.625 * t) / (243.04 + t));
  return Math.max(0, Math.min(100, Math.round((100 * e(dewPointC)) / e(tempC))));
}

type Nearest = { name: string; value: number; distanceKm: number; observedAt: string };

export function nearestNea(body: NeaResponse, lat: number, lon: number): Nearest | null {
  const reading = body.data.readings[0];
  if (!reading) return null;
  const stations = new Map(body.data.stations.map((s) => [s.id, s]));
  let best: Nearest | null = null;
  for (const r of reading.data) {
    const s = stations.get(r.stationId);
    if (!s || !Number.isFinite(r.value)) continue;
    const d = haversineKm(lat, lon, s.location.latitude, s.location.longitude);
    if (!best || d < best.distanceKm) {
      best = { name: s.name, value: r.value, distanceKm: d, observedAt: new Date(reading.timestamp).toISOString() };
    }
  }
  return best;
}

export function nearestMetar(reports: Metar[], lat: number, lon: number, now: number): { m: Metar; d: number } | null {
  let best: { m: Metar; d: number } | null = null;
  for (const m of reports) {
    if (m.temp == null || m.dewp == null) continue;
    if (now - m.obsTime * 1000 > METAR_MAX_AGE_MS) continue;
    const d = haversineKm(lat, lon, m.lat, m.lon);
    if (d > METAR_MAX_KM) continue;
    // Prefer the closest station; for the same station keep the newest report.
    if (!best || d < best.d - 0.01 || (Math.abs(d - best.d) <= 0.01 && m.obsTime > best.m.obsTime)) best = { m, d };
  }
  return best;
}

const round1 = (n: number) => Math.round(n * 10) / 10;

export class LiveConditionsService {
  private nea = new TtlCache<NeaResponse>(60_000, 4);
  private results = new TtlCache<LiveConditions>(5 * 60_000, 2000);

  async get(lat: number, lon: number, signal?: AbortSignal): Promise<LiveConditions> {
    const key = `${lat.toFixed(2)},${lon.toFixed(2)}`;
    const cached = this.results.get(key);
    if (cached) return cached;

    const result =
      (await this.fromNea(lat, lon, signal).catch(() => null)) ??
      (await this.fromMetar(lat, lon, signal).catch(() => null)) ??
      (await this.fromOpenMeteo(lat, lon, signal));
    // NEA updates every minute; airport reports every 30-60 minutes.
    this.results.set(key, result, result.source.startsWith("NEA") ? 60_000 : 5 * 60_000);
    return result;
  }

  private async neaLatest(url: string, source: string, signal?: AbortSignal): Promise<NeaResponse> {
    const hit = this.nea.get(url);
    if (hit) return hit;
    const body = await fetchJson(url, neaResponse, { source, timeoutMs: 8000, retries: 1, signal });
    this.nea.set(url, body);
    return body;
  }

  private async fromNea(lat: number, lon: number, signal?: AbortSignal): Promise<LiveConditions | null> {
    // Only Singapore and its immediate surroundings are covered by the NEA network.
    if (lat < 1.1 || lat > 1.55 || lon < 103.55 || lon > 104.15) return null;
    const [t, rh] = await Promise.all([
      this.neaLatest(NEA_TEMP_URL, "NEA air temperature", signal),
      this.neaLatest(NEA_RH_URL, "NEA relative humidity", signal),
    ]);
    const temp = nearestNea(t, lat, lon);
    const hum = nearestNea(rh, lat, lon);
    if (!temp || !hum || temp.distanceKm > NEA_MAX_KM || hum.distanceKm > NEA_MAX_KM) return null;
    if (Date.now() - Date.parse(temp.observedAt) > NEA_MAX_AGE_MS) return null;
    return {
      temperatureC: round1(temp.value),
      relativeHumidityPercent: Math.round(hum.value),
      observedAt: temp.observedAt,
      kind: "station",
      source: "NEA weather stations (data.gov.sg)",
      stationName: temp.name,
      distanceKm: round1(temp.distanceKm),
    };
  }

  private async fromMetar(lat: number, lon: number, signal?: AbortSignal): Promise<LiveConditions | null> {
    const pad = 0.5; // about 55 km, enough to cover METAR_MAX_KM
    const bbox = [lat - pad, lon - pad, lat + pad, lon + pad].map((n) => n.toFixed(2)).join(",");
    const url = `https://aviationweather.gov/api/data/metar?bbox=${bbox}&format=json&hours=3`;
    const reports = await fetchJson(url, metarResponse, { source: "Aviation Weather Center", timeoutMs: 8000, retries: 1, signal });
    const best = nearestMetar(reports, lat, lon, Date.now());
    if (!best) return null;
    return {
      temperatureC: best.m.temp!,
      relativeHumidityPercent: humidityFromDewPoint(best.m.temp!, best.m.dewp!),
      observedAt: new Date(best.m.obsTime * 1000).toISOString(),
      kind: "station",
      source: "Airport weather report (METAR)",
      stationName: best.m.name?.split(",")[0]?.trim() || best.m.icaoId,
      distanceKm: round1(best.d),
    };
  }

  private async fromOpenMeteo(lat: number, lon: number, signal?: AbortSignal): Promise<LiveConditions> {
    const url =
      `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}` +
      "&current=temperature_2m,relative_humidity_2m&timezone=auto";
    const body = await fetchJson(url, openMeteoCurrent, { source: "Open-Meteo", timeoutMs: 8000, signal });
    const { temperature_2m: t, relative_humidity_2m: rh, time } = body.current;
    if (t === null || rh === null) throw new Error("Open-Meteo returned no current conditions");
    const observed = Date.parse(`${time}:00Z`) - body.utc_offset_seconds * 1000;
    return {
      temperatureC: t,
      relativeHumidityPercent: rh,
      observedAt: new Date(observed).toISOString(),
      kind: "model",
      source: "Open-Meteo weather model (estimate)",
      stationName: null,
      distanceKm: null,
    };
  }
}
