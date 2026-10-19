import { API_BASE_URL } from "./api";

export type HeatBand = "Low" | "Moderate" | "High";

export type CityHeat = {
  temperature: number; // °C
  humidity: number;    // %
  wbgt: number;        // estimated °C
  band: HeatBand;
  observedAt: string; // when the reading was taken (UTC ISO)
  live: boolean;      // true for a real station reading, false for a model estimate
  source: string;
  stationName: string | null;
  distanceKm: number | null;
};

// NEA heat-stress bands
export function bandFor(wbgt: number): HeatBand {
  if (wbgt >= 33) return "High";
  if (wbgt >= 31) return "Moderate";
  return "Low";
}

// Simplified WBGT estimate from temperature and humidity
// (Australian Bureau of Meteorology formula, shade conditions)
export function estimateWbgt(tempC: number, humidity: number) {
  const vapourPressure =
    (humidity / 100) * 6.105 * Math.exp((17.27 * tempC) / (237.7 + tempC));
  return 0.567 * tempC + 0.393 * vapourPressure + 3.94;
}

type Reading = Omit<CityHeat, "wbgt" | "band">;

function withHeat(r: Reading): CityHeat {
  const wbgt = Math.round(estimateWbgt(r.temperature, r.humidity) * 10) / 10;
  return { ...r, wbgt, band: bandFor(wbgt) };
}

// Readings are kept only briefly so the Home screen's periodic refresh gets fresh data.
const heatCache = new Map<string, { data: CityHeat; expires: number }>();
const CACHE_MS = 60_000;

/** Live temperature and humidity: nearest weather station via the backend, else an Open-Meteo estimate. */
export async function fetchCityHeat(lat: number, lon: number): Promise<CityHeat> {
  const cacheKey = `${lat.toFixed(3)},${lon.toFixed(3)}`;
  const cached = heatCache.get(cacheKey);
  if (cached && cached.expires > Date.now()) return cached.data;

  const result = (await fromBackend(lat, lon).catch(() => null)) ?? (await fromOpenMeteo(lat, lon));
  heatCache.set(cacheKey, { data: result, expires: Date.now() + CACHE_MS });
  return result;
}

async function fromBackend(lat: number, lon: number): Promise<CityHeat> {
  const res = await fetch(`${API_BASE_URL}/api/v1/conditions/live?lat=${lat}&lon=${lon}`, {
    signal: AbortSignal.timeout(12000),
  });
  if (!res.ok) throw new Error(`Live conditions request failed (${res.status})`);
  const j = await res.json();
  if (typeof j.temperatureC !== "number" || typeof j.relativeHumidityPercent !== "number") {
    throw new Error("Invalid live conditions received");
  }
  return withHeat({
    temperature: j.temperatureC,
    humidity: j.relativeHumidityPercent,
    observedAt: j.observedAt,
    live: j.kind === "station",
    source: j.source,
    stationName: j.stationName ?? null,
    distanceKm: j.distanceKm ?? null,
  });
}

// Used only when the UrbanHeat Watch server cannot be reached.
async function fromOpenMeteo(lat: number, lon: number): Promise<CityHeat> {
  const url =
    `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}` +
    `&current=temperature_2m,relative_humidity_2m&timezone=GMT`;
  const res = await fetch(url, { signal: AbortSignal.timeout(8000) });
  if (!res.ok) throw new Error(`Weather request failed (${res.status})`);
  const json = await res.json();
  if (!json.current || typeof json.current.temperature_2m !== "number") {
    throw new Error("Invalid weather data received");
  }
  return withHeat({
    temperature: json.current.temperature_2m,
    humidity: json.current.relative_humidity_2m,
    observedAt: `${json.current.time}:00Z`,
    live: false,
    source: "Open-Meteo weather model (estimate)",
    stationName: null,
    distanceKm: null,
  });
}
