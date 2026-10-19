import { z } from "zod";
import { TtlCache } from "./cache.js";
import { fetchJson } from "./http.js";

/**
 * Country-wide forecast heat grid (1–24 h ahead) from Open-Meteo hourly model output.
 * Values are modelled air / apparent temperature at grid points, not observations,
 * not satellite surface temperature and not a warning.
 */

// [west, south, east, north] — approximate national extents for ASEAN members.
export const COUNTRY_BBOX: Record<string, { name: string; bbox: [number, number, number, number] }> = {
  SG: { name: "Singapore", bbox: [103.6, 1.2, 104.05, 1.48] },
  MY: { name: "Malaysia", bbox: [99.6, 0.85, 119.3, 7.4] },
  ID: { name: "Indonesia", bbox: [95.0, -11.0, 141.0, 6.1] },
  TH: { name: "Thailand", bbox: [97.3, 5.6, 105.7, 20.5] },
  VN: { name: "Vietnam", bbox: [102.1, 8.4, 109.5, 23.4] },
  PH: { name: "Philippines", bbox: [116.9, 4.6, 126.6, 21.1] },
  MM: { name: "Myanmar", bbox: [92.2, 9.6, 101.2, 28.5] },
  KH: { name: "Cambodia", bbox: [102.3, 10.4, 107.7, 14.7] },
  LA: { name: "Laos", bbox: [100.1, 13.9, 107.7, 22.5] },
  BN: { name: "Brunei", bbox: [114.0, 4.0, 115.4, 5.1] },
  TL: { name: "Timor-Leste", bbox: [124.0, -9.5, 127.4, -8.1] },
  CN: { name: "China", bbox: [73.5, 18.2, 135.0, 53.5] },
  HK: { name: "Hong Kong", bbox: [113.8, 22.1, 114.4, 22.6] },
  IN: { name: "India", bbox: [68.1, 6.7, 97.4, 35.5] },
};

export type HeatVariable = "temperature_2m" | "apparent_temperature";

export type HeatGrid = {
  countryCode: string;
  country: string;
  variable: HeatVariable;
  variableLabel: string;
  dataType: "modelled_forecast";
  provider: string;
  bbox: [number, number, number, number];
  rows: number;
  cols: number;
  cellLatDeg: number;
  cellLonDeg: number;
  /** Forecast valid times (ISO UTC), index 0 = +1 h. */
  times: string[];
  /** Cell centres, row-major from north-west. */
  cells: { lat: number; lon: number; values: (number | null)[] }[];
  legend: { units: "°C"; stops: { valueC: number; color: string }[] };
  fetchedAt: string;
  limitations: string[];
};

export const HEAT_LEGEND = [
  { valueC: 20, color: "#4575b4" },
  { valueC: 24, color: "#74add1" },
  { valueC: 27, color: "#abd9e9" },
  { valueC: 30, color: "#fee090" },
  { valueC: 33, color: "#fdae61" },
  { valueC: 36, color: "#f46d43" },
  { valueC: 40, color: "#a50026" },
];

const MAX_POINTS = 144;
const BATCH = 48;
const HOURS = 24;

const locationSchema = z.object({
  latitude: z.number(),
  longitude: z.number(),
  hourly: z.object({
    time: z.array(z.string()),
    temperature_2m: z.array(z.number().nullable()),
    apparent_temperature: z.array(z.number().nullable()),
  }),
});
const responseSchema = z.union([z.array(locationSchema), locationSchema]);

export function gridFor(bbox: [number, number, number, number], maxPoints = MAX_POINTS) {
  const [w, s, e, n] = bbox;
  const aspect = ((e - w) * Math.cos(((s + n) / 2) * (Math.PI / 180))) / (n - s);
  let cols = Math.max(2, Math.round(Math.sqrt(maxPoints * aspect)));
  let rows = Math.max(2, Math.floor(maxPoints / cols));
  cols = Math.min(cols, Math.floor(maxPoints / rows));
  const dLon = (e - w) / cols;
  const dLat = (n - s) / rows;
  const points: { lat: number; lon: number }[] = [];
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      points.push({ lat: +(n - (r + 0.5) * dLat).toFixed(4), lon: +(w + (c + 0.5) * dLon).toFixed(4) });
    }
  }
  return { rows, cols, dLat, dLon, points };
}

export class HeatGridService {
  // One fetch per country returns both variables; in-flight requests are shared.
  private raw = new TtlCache<Promise<z.infer<typeof locationSchema>[]>>(30 * 60_000, 20);

  async get(countryCode: string, variable: HeatVariable): Promise<HeatGrid | null> {
    const country = COUNTRY_BBOX[countryCode];
    if (!country) return null;
    const { rows, cols, dLat, dLon, points } = gridFor(country.bbox);
    let pending = this.raw.get(countryCode);
    if (!pending) {
      pending = this.fetchPoints(points);
      this.raw.set(countryCode, pending);
      // Never cache a failure.
      pending.catch(() => this.raw.delete(countryCode));
    }
    const results = await pending;

    // Start from the first forecast hour strictly after now.
    const now = Date.now();
    const allTimes = results[0]!.hourly.time.map((t) => new Date(`${t}Z`).toISOString());
    let start = allTimes.findIndex((t) => Date.parse(t) > now);
    if (start < 0) start = 0;
    const times = allTimes.slice(start, start + HOURS);

    const grid: HeatGrid = {
      countryCode,
      country: country.name,
      variable,
      variableLabel: variable === "temperature_2m" ? "Air temperature (2 m)" : "Apparent temperature",
      dataType: "modelled_forecast",
      provider: "Open-Meteo forecast API",
      bbox: country.bbox,
      rows,
      cols,
      cellLatDeg: dLat,
      cellLonDeg: dLon,
      times,
      cells: points.map((p, i) => {
        const h = results[i]!.hourly;
        const series = h[variable];
        if (h.time.length !== series.length) return { ...p, values: times.map(() => null) };
        return { ...p, values: series.slice(start, start + HOURS).map((v) => v ?? null) };
      }),
      legend: { units: "°C", stops: HEAT_LEGEND },
      fetchedAt: new Date().toISOString(),
      limitations: [
        "Hourly numerical-model forecast sampled at grid points; each cell shows the value at its centre.",
        `Grid spacing about ${Math.round(dLat * 111)} km; local differences within a cell are not shown.`,
        "This is air (or apparent) temperature, not satellite surface temperature and not an official warning.",
      ],
    };
    return grid;
  }

  private async fetchPoints(points: { lat: number; lon: number }[]) {
    const batches: { lat: number; lon: number }[][] = [];
    for (let i = 0; i < points.length; i += BATCH) batches.push(points.slice(i, i + BATCH));
    const parts = await Promise.all(
      batches.map(async (batch) => {
        const url =
          "https://api.open-meteo.com/v1/forecast?" +
          `latitude=${batch.map((p) => p.lat).join(",")}&longitude=${batch.map((p) => p.lon).join(",")}` +
          "&hourly=temperature_2m,apparent_temperature&forecast_hours=25&timezone=GMT&temperature_unit=celsius";
        const body = await fetchJson(url, responseSchema, { source: "Open-Meteo forecast API", timeoutMs: 25_000 });
        const arr = Array.isArray(body) ? body : [body];
        if (arr.length !== batch.length) throw new Error("Open-Meteo returned an unexpected number of locations");
        return arr;
      }),
    );
    return parts.flat();
  }
}
