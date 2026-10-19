import { z } from "zod";
import { TtlCache } from "./cache.js";
import { fetchJson } from "./http.js";
import type { HourlyPoint, Place, WbgtObservation, Weather } from "./types.js";

/** Pluggable weather source so a national meteorological service can replace Open-Meteo. */
export interface WeatherProvider {
  readonly name: string;
  fetch(place: Place, signal?: AbortSignal): Promise<Weather>;
}

const nullableNum = z.number().nullable();

const openMeteoResponse = z.object({
  latitude: z.number(),
  longitude: z.number(),
  utc_offset_seconds: z.number().int(),
  timezone: z.string().optional(),
  current_units: z.record(z.string(), z.string()),
  current: z.object({
    time: z.string(),
    interval: z.number().optional(),
    temperature_2m: nullableNum,
    relative_humidity_2m: nullableNum,
    apparent_temperature: nullableNum,
    wind_speed_10m: nullableNum,
  }),
  hourly_units: z.record(z.string(), z.string()),
  hourly: z.object({
    time: z.array(z.string()),
    temperature_2m: z.array(nullableNum),
    relative_humidity_2m: z.array(nullableNum),
    apparent_temperature: z.array(nullableNum),
  }),
});
export type OpenMeteoResponse = z.infer<typeof openMeteoResponse>;

const EXPECTED_UNITS: Record<string, string> = {
  temperature_2m: "°C",
  apparent_temperature: "°C",
  relative_humidity_2m: "%",
  wind_speed_10m: "km/h",
};

/** Open-Meteo returns local wall-clock times plus a UTC offset; convert to UTC ISO. */
export function localToUtcIso(local: string, offsetSeconds: number): string | null {
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2})?$/.test(local)) return null;
  const asUtc = Date.parse(`${local.length === 16 ? `${local}:00` : local}Z`);
  return Number.isFinite(asUtc) ? new Date(asUtc - offsetSeconds * 1000).toISOString() : null;
}

/** Validate units, array lengths, coordinates and timestamps; never coerce null to zero. */
export function normalizeOpenMeteo(
  body: OpenMeteoResponse,
  place: Place,
  now: Date,
  staleAfterMs: number,
): Weather {
  const base = emptyWeather("Open-Meteo forecast API");
  for (const [k, unit] of Object.entries(EXPECTED_UNITS)) {
    const got = body.current_units[k] ?? body.hourly_units[k];
    if (got !== undefined && got !== unit) {
      return { ...base, status: "error", message: `Unexpected unit for ${k}: ${got}` };
    }
  }
  // Model grid cells are a few km; a large offset means the wrong location was returned.
  if (Math.abs(body.latitude - place.latitude) > 0.5 || angularLonDiff(body.longitude, place.longitude) > 0.5) {
    return { ...base, status: "error", message: "Weather grid point does not match the requested location" };
  }
  const h = body.hourly;
  const n = h.time.length;
  if (h.temperature_2m.length !== n || h.relative_humidity_2m.length !== n || h.apparent_temperature.length !== n) {
    return { ...base, status: "error", message: "Hourly arrays have inconsistent lengths" };
  }
  const validAt = localToUtcIso(body.current.time, body.utc_offset_seconds);
  if (!validAt) return { ...base, status: "error", message: "Invalid current-conditions timestamp" };

  const hourly: HourlyPoint[] = [];
  for (let i = 0; i < n; i++) {
    const t = localToUtcIso(h.time[i]!, body.utc_offset_seconds);
    if (!t) continue;
    hourly.push({
      time: t,
      temperatureC: h.temperature_2m[i] ?? null,
      relativeHumidityPercent: h.relative_humidity_2m[i] ?? null,
      apparentTemperatureC: h.apparent_temperature[i] ?? null,
    });
  }
  const age = now.getTime() - Date.parse(validAt);
  return {
    ...base,
    status: age > staleAfterMs ? "stale" : "available",
    validAt,
    fetchedAt: now.toISOString(),
    gridLatitude: body.latitude,
    gridLongitude: body.longitude,
    temperatureC: body.current.temperature_2m,
    relativeHumidityPercent: body.current.relative_humidity_2m,
    apparentTemperatureC: body.current.apparent_temperature,
    windSpeedKmh: body.current.wind_speed_10m,
    hourly,
    message: age > staleAfterMs ? "Weather data is older than expected." : null,
  };
}

function angularLonDiff(a: number, b: number): number {
  const d = Math.abs(a - b) % 360;
  return d > 180 ? 360 - d : d;
}

export function emptyWeather(provider: string): Weather {
  return {
    status: "unavailable",
    dataType: "modelled",
    provider,
    validAt: null,
    fetchedAt: null,
    gridLatitude: null,
    gridLongitude: null,
    temperatureC: null,
    relativeHumidityPercent: null,
    apparentTemperatureC: null,
    windSpeedKmh: null,
    hourly: [],
    message: null,
  };
}

export class OpenMeteoProvider implements WeatherProvider {
  readonly name = "Open-Meteo forecast API";
  private cache: TtlCache<Weather>;

  constructor(
    private ttlMs: number,
    private staleAfterMs: number,
  ) {
    this.cache = new TtlCache<Weather>(ttlMs, 2000);
  }

  async fetch(place: Place, signal?: AbortSignal): Promise<Weather> {
    const cached = this.cache.get(place.id);
    if (cached) {
      // Re-evaluate staleness against the observation time, not the fetch time.
      const age = cached.validAt ? Date.now() - Date.parse(cached.validAt) : Infinity;
      return age > this.staleAfterMs ? { ...cached, status: "stale" } : cached;
    }
    const url =
      `https://api.open-meteo.com/v1/forecast?latitude=${place.latitude}&longitude=${place.longitude}` +
      "&current=temperature_2m,relative_humidity_2m,apparent_temperature,wind_speed_10m" +
      "&hourly=temperature_2m,relative_humidity_2m,apparent_temperature" +
      "&forecast_days=2&timezone=auto&temperature_unit=celsius&wind_speed_unit=kmh";
    const body = await fetchJson(url, openMeteoResponse, { source: this.name, timeoutMs: 10_000, signal });
    const weather = normalizeOpenMeteo(body, place, new Date(), this.staleAfterMs);
    if (weather.status === "available") this.cache.set(place.id, weather);
    return weather;
  }
}

// ---------------------------------------------------------------- Singapore NEA WBGT

const NEA_WBGT_URL = "https://api-open.data.gov.sg/v2/real-time/api/weather?api=wbgt";
const NEA_MAX_STATION_KM = 10;
const NEA_STALE_AFTER_MS = 90 * 60_000;

const neaWbgtResponse = z.object({
  code: z.number(),
  data: z.object({
    records: z.array(
      z.object({
        datetime: z.string(),
        item: z.object({
          readings: z.array(
            z.object({
              station: z.object({ id: z.string(), name: z.string() }),
              location: z.object({ latitude: z.string(), longitude: z.string() }),
              wbgt: z.string(),
              heatStress: z.string(),
            }),
          ),
        }),
      }),
    ),
  }),
});
export type NeaWbgtResponse = z.infer<typeof neaWbgtResponse>;

export function haversineKm(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  return 2 * 6371.0088 * Math.asin(Math.sqrt(a));
}

export function nearestWbgt(body: NeaWbgtResponse, place: Place, now: Date): WbgtObservation {
  const base: WbgtObservation = {
    status: "unavailable",
    provider: "NEA via data.gov.sg (WBGT)",
    dataType: "station_observation",
    stationId: null,
    stationName: null,
    stationDistanceKm: null,
    wbgtC: null,
    heatStressCategory: null,
    observedAt: null,
    fetchedAt: now.toISOString(),
    representativeness: `Nearest NEA WBGT station; used only within ${NEA_MAX_STATION_KM} km of the city centre.`,
    message: null,
  };
  const record = body.data.records[0];
  if (!record) return { ...base, message: "No WBGT readings published." };
  const observed = Date.parse(record.datetime);
  if (!Number.isFinite(observed)) return { ...base, status: "error", message: "Invalid WBGT timestamp" };
  let best: { r: (typeof record.item.readings)[number]; d: number } | null = null;
  for (const r of record.item.readings) {
    const lat = Number(r.location.latitude);
    const lon = Number(r.location.longitude);
    const wbgt = Number(r.wbgt);
    if (!Number.isFinite(lat) || !Number.isFinite(lon) || !Number.isFinite(wbgt) || r.wbgt.trim() === "") continue;
    const d = haversineKm(place.latitude, place.longitude, lat, lon);
    if (!best || d < best.d) best = { r, d };
  }
  if (!best) return { ...base, message: "No valid WBGT station readings." };
  const stale = now.getTime() - observed > NEA_STALE_AFTER_MS;
  return {
    ...base,
    status: best.d > NEA_MAX_STATION_KM ? "unavailable" : stale ? "stale" : "available",
    stationId: best.r.station.id,
    stationName: best.r.station.name,
    stationDistanceKm: Number(best.d.toFixed(1)),
    wbgtC: Number(best.r.wbgt),
    heatStressCategory: best.r.heatStress,
    observedAt: new Date(observed).toISOString(),
    message: best.d > NEA_MAX_STATION_KM ? "Nearest WBGT station is too far to represent this location." : null,
  };
}

export class NeaWbgtProvider {
  private cache = new TtlCache<NeaWbgtResponse>(5 * 60_000, 4);

  async fetch(place: Place, signal?: AbortSignal): Promise<WbgtObservation | null> {
    if (place.countryCode !== "SG") return null;
    let body = this.cache.get("latest");
    if (!body) {
      body = await fetchJson(NEA_WBGT_URL, neaWbgtResponse, { source: "NEA WBGT", timeoutMs: 8000, signal });
      this.cache.set("latest", body);
    }
    return nearestWbgt(body, place, new Date());
  }
}
