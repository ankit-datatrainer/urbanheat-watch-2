import { API_BASE_URL } from "./api";

// Satellite land-surface temperature (NASA MODIS via the UrbanHeat Watch API).

export type SatelliteLst = {
  available: true;
  source: string;
  layerId: string;
  date: string;
  composite: boolean;
  centerC: number | null;
  meanC: number | null;
  maxC: number | null;
  minC: number | null;
  validPixels: number;
  totalPixels: number;
  coveragePercent: number;
  /** Oldest imagery date used to fill cloud gaps, or null when none were needed. */
  filledFrom?: string | null;
  hotspot: { lat: number; lon: number; valueC: number } | null;
  note: string;
};

export type SatelliteResult = SatelliteLst | { available: false; message: string };

/** °C stops of the map palette; must match HEAT_STOPS in backend/api/src/gibs.ts. */
export const HEAT_LEGEND: { c: number; color: string }[] = [
  { c: 22, color: "#2C7BB6" },
  { c: 26, color: "#ABD9E9" },
  { c: 29, color: "#FFFFBF" },
  { c: 32, color: "#FDAE61" },
  { c: 36, color: "#F46D43" },
  { c: 40, color: "#D73027" },
  { c: 45, color: "#7F0000" },
];

const cache = new Map<string, { at: number; data: SatelliteResult }>();

export async function fetchSatelliteLst(lat: number, lon: number, radiusKm = 15, signal?: AbortSignal) {
  const key = `${lat.toFixed(3)},${lon.toFixed(3)},${radiusKm}`;
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < 30 * 60_000) return hit.data;
  const res = await fetch(`${API_BASE_URL}/api/v1/satellite/lst?lat=${lat}&lon=${lon}&radiusKm=${radiusKm}`, {
    signal: signal ?? AbortSignal.timeout(30000),
  });
  if (!res.ok) throw new Error(`Satellite request failed (${res.status})`);
  const data = (await res.json()) as SatelliteResult;
  cache.set(key, { at: Date.now(), data });
  return data;
}

export async function fetchSatellitePoint(lat: number, lon: number, layerId: string, date: string) {
  const q = new URLSearchParams({ lat: String(lat), lon: String(lon), layerId, date });
  const res = await fetch(`${API_BASE_URL}/api/v1/satellite/lst/point?${q}`, { signal: AbortSignal.timeout(20000) });
  if (!res.ok) throw new Error(`Satellite request failed (${res.status})`);
  return (await res.json()) as { valueC: number | null };
}

/** Tile template for the app's re-coloured heat layer ({z}/{x}/{y}). */
export function heatTileTemplate(layerId: string, date: string) {
  return `${API_BASE_URL}/api/v1/satellite/tiles/${layerId}/${date}/{z}/{x}/{y}.png`;
}

export function formatSatDate(date: string, locale: string) {
  try {
    return new Date(`${date}T12:00:00Z`).toLocaleDateString(locale, { day: "numeric", month: "short" });
  } catch {
    return date;
  }
}
