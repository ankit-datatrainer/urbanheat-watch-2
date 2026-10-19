import { PNG } from "pngjs";
import { TtlCache } from "./cache.js";

// Satellite land-surface temperature from NASA GIBS (MODIS on Terra and Aqua).
// GIBS serves colour-mapped PNG tiles with no API key; each colour maps to a 0.6 K band of the
// MODIS LST product, so pixels are decoded back to temperatures with the published colormap.

export const GIBS_BASE = "https://gibs.earthdata.nasa.gov/wmts/epsg3857/best";
const COLORMAP_URL = "https://gibs.earthdata.nasa.gov/colormaps/v1.3/MODIS_Land_Surface_Temp.xml";
const ZOOM = 7; // the native level of the LST layers (~1.2 km pixels at the equator)
const TILE = 256;

export type LstLayer = {
  id: string;
  satellite: "Terra" | "Aqua";
  kind: "daily" | "8-day";
};

/** Freshest first: today's and yesterday's daily passes, then the cloud-filling 8-day composite. */
export const LST_LAYERS: Record<string, LstLayer> = {
  MODIS_Terra_Land_Surface_Temp_Day: { id: "MODIS_Terra_Land_Surface_Temp_Day", satellite: "Terra", kind: "daily" },
  MODIS_Aqua_Land_Surface_Temp_Day: { id: "MODIS_Aqua_Land_Surface_Temp_Day", satellite: "Aqua", kind: "daily" },
  MODIS_Terra_L3_Land_Surface_Temp_8Day_Day: {
    id: "MODIS_Terra_L3_Land_Surface_Temp_8Day_Day",
    satellite: "Terra",
    kind: "8-day",
  },
};

export type SatelliteLst = {
  source: string;
  layerId: string;
  /** Acquisition date (UTC) of the imagery that was read; for the 8-day product, the period start. */
  date: string;
  composite: boolean;
  centerC: number | null;
  meanC: number | null;
  maxC: number | null;
  minC: number | null;
  validPixels: number;
  totalPixels: number;
  coveragePercent: number;
  hotspot: { lat: number; lon: number; valueC: number } | null;
  tileUrlTemplate: string;
  note: string;
};

type Fetch = typeof fetch;

function project(lat: number, lon: number) {
  const n = TILE * 2 ** ZOOM;
  const s = Math.sin((Math.max(-85.05, Math.min(85.05, lat)) * Math.PI) / 180);
  return { x: ((lon + 180) / 360) * n, y: (0.5 - Math.log((1 + s) / (1 - s)) / (4 * Math.PI)) * n };
}

function unproject(x: number, y: number) {
  const n = TILE * 2 ** ZOOM;
  return {
    lon: (x / n) * 360 - 180,
    lat: (Math.atan(Math.sinh(Math.PI * (1 - (2 * y) / n))) * 180) / Math.PI,
  };
}

/** °C stops of the app's heat palette (blue = cool ground, deep red = dangerously hot). */
export const HEAT_STOPS: [number, [number, number, number]][] = [
  [22, [44, 123, 182]],
  [26, [171, 217, 233]],
  [29, [255, 255, 191]],
  [32, [253, 174, 97]],
  [36, [244, 109, 67]],
  [40, [215, 48, 39]],
  [45, [127, 0, 0]],
];

export function heatColor(c: number): [number, number, number] {
  if (c <= HEAT_STOPS[0]![0]) return HEAT_STOPS[0]![1];
  for (let i = 1; i < HEAT_STOPS.length; i++) {
    const [t1, c1] = HEAT_STOPS[i]!;
    const [t0, c0] = HEAT_STOPS[i - 1]!;
    if (c <= t1) {
      const f = (c - t0) / (t1 - t0);
      return [0, 1, 2].map((k) => Math.round(c0[k]! + (c1[k]! - c0[k]!) * f)) as [number, number, number];
    }
  }
  return HEAT_STOPS[HEAT_STOPS.length - 1]![1];
}

function isoDay(offsetDays: number) {
  return new Date(Date.now() - offsetDays * 86400_000).toISOString().slice(0, 10);
}

/** Start dates of the most recent MODIS 8-day periods (day-of-year 1, 9, 17, ... each year). */
export function compositeStarts(count: number, now = new Date()) {
  const out: string[] = [];
  let year = now.getUTCFullYear();
  let doy = Math.floor((Date.UTC(year, now.getUTCMonth(), now.getUTCDate()) - Date.UTC(year, 0, 1)) / 86400_000) + 1;
  let start = doy - ((doy - 1) % 8);
  while (out.length < count) {
    out.push(new Date(Date.UTC(year, 0, start)).toISOString().slice(0, 10));
    start -= 8;
    if (start < 1) {
      year -= 1;
      const days = (Date.UTC(year + 1, 0, 1) - Date.UTC(year, 0, 1)) / 86400_000;
      start = days - ((days - 1) % 8);
    }
  }
  return out;
}

export function tileUrl(layerId: string, date: string) {
  return `${GIBS_BASE}/${layerId}/default/${date}/GoogleMapsCompatible_Level7/{z}/{y}/{x}.png`;
}

export class GibsLstService {
  private colormap: Promise<Map<number, number>> | null = null;
  private tiles = new TtlCache<Promise<PNG | null>>(3 * 3600_000, 300);
  private results = new TtlCache<SatelliteLst | null>(3600_000, 500);

  constructor(private fetchImpl: Fetch = fetch) {}

  /** rgb (packed) -> Kelvin, from the published GIBS colormap (centre of each 0.6 K band). */
  private loadColormap() {
    if (!this.colormap) {
      this.colormap = this.fetchImpl(COLORMAP_URL, { signal: AbortSignal.timeout(15000) })
        .then((r) => {
          if (!r.ok) throw new Error(`colormap ${r.status}`);
          return r.text();
        })
        .then((xml) => {
          const map = new Map<number, number>();
          const re = /rgb="(\d+),(\d+),(\d+)"[^>]*?value="\[([\d.]+),([\d.]+)\)"/g;
          for (const m of xml.matchAll(re)) {
            const key = (Number(m[1]) << 16) | (Number(m[2]) << 8) | Number(m[3]);
            map.set(key, (Number(m[4]) + Number(m[5])) / 2);
          }
          if (map.size < 100) throw new Error("colormap parse failed");
          return map;
        })
        .catch((e) => {
          this.colormap = null;
          throw e;
        });
    }
    return this.colormap;
  }

  private tile(layerId: string, date: string, x: number, y: number, z = ZOOM) {
    const key = `${layerId}/${date}/${z}/${x}/${y}`;
    let hit = this.tiles.get(key);
    if (!hit) {
      const url = tileUrl(layerId, date).replace("{z}", String(z)).replace("{y}", String(y)).replace("{x}", String(x));
      hit = this.fetchImpl(url, { signal: AbortSignal.timeout(15000) })
        .then(async (r) => {
          if (!r.ok) return null;
          const buf = Buffer.from(await r.arrayBuffer());
          return PNG.sync.read(buf);
        })
        .catch(() => null);
      this.tiles.set(key, hit);
    }
    return hit;
  }

  /**
   * One GIBS tile re-coloured with a palette tuned for tropical surface temperatures
   * (the NASA palette is almost uniformly yellow between 25 and 40 °C). Null if missing.
   */
  async heatTile(layerId: string, date: string, z: number, x: number, y: number): Promise<Buffer | null> {
    if (z > ZOOM || z < 0) return null;
    const cmap = await this.loadColormap();
    const src = await this.tile(layerId, date, x, y, z);
    if (!src) return null;
    const out = new PNG({ width: TILE, height: TILE });
    for (let i = 0; i < src.data.length; i += 4) {
      const kelvin =
        src.data[i + 3] === 0 ? undefined : cmap.get((src.data[i]! << 16) | (src.data[i + 1]! << 8) | src.data[i + 2]!);
      if (kelvin === undefined) continue; // stays transparent
      const [r, g, b] = heatColor(kelvin - 273.15);
      out.data[i] = r;
      out.data[i + 1] = g;
      out.data[i + 2] = b;
      out.data[i + 3] = 215;
    }
    return PNG.sync.write(out);
  }

  /** Reads one layer/date for a circle around the point. Null when the imagery is missing. */
  async read(layer: LstLayer, date: string, lat: number, lon: number, radiusKm: number): Promise<SatelliteLst | null> {
    const cmap = await this.loadColormap();
    const c = project(lat, lon);
    const kmPerPx = (40075 * Math.cos((lat * Math.PI) / 180)) / (TILE * 2 ** ZOOM);
    const r = Math.max(0, radiusKm / kmPerPx);
    const x0 = Math.floor(c.x - r);
    const x1 = Math.floor(c.x + r);
    const y0 = Math.floor(c.y - r);
    const y1 = Math.floor(c.y + r);

    const tiles = new Map<string, PNG | null>();
    for (let tx = Math.floor(x0 / TILE); tx <= Math.floor(x1 / TILE); tx++) {
      for (let ty = Math.floor(y0 / TILE); ty <= Math.floor(y1 / TILE); ty++) {
        tiles.set(`${tx},${ty}`, await this.tile(layer.id, date, tx, ty));
      }
    }
    if ([...tiles.values()].every((t) => t === null)) return null;

    const valueAt = (px: number, py: number): number | null => {
      const png = tiles.get(`${Math.floor(px / TILE)},${Math.floor(py / TILE)}`);
      if (!png) return null;
      const i = ((py % TILE) * TILE + (px % TILE)) * 4;
      if (png.data[i + 3] === 0) return null; // cloud, water or no pass
      const kelvin = cmap.get((png.data[i]! << 16) | (png.data[i + 1]! << 8) | png.data[i + 2]!);
      return kelvin === undefined ? null : Math.round((kelvin - 273.15) * 10) / 10;
    };

    let total = 0;
    let sum = 0;
    const values: number[] = [];
    let hot: { px: number; py: number; v: number } | null = null;
    for (let py = y0; py <= y1; py++) {
      for (let px = x0; px <= x1; px++) {
        if ((px + 0.5 - c.x) ** 2 + (py + 0.5 - c.y) ** 2 > Math.max(r, 0.5) ** 2) continue;
        total++;
        const v = valueAt(px, py);
        if (v === null) continue;
        values.push(v);
        sum += v;
        if (!hot || v > hot.v) hot = { px, py, v };
      }
    }
    const centerC = valueAt(Math.floor(c.x), Math.floor(c.y));
    const hotPos = hot ? unproject(hot.px + 0.5, hot.py + 0.5) : null;
    const coverage = total ? Math.round((values.length / total) * 100) : 0;

    return {
      source: `NASA MODIS ${layer.satellite} via NASA GIBS`,
      layerId: layer.id,
      date,
      composite: layer.kind === "8-day",
      centerC,
      meanC: values.length ? Math.round((sum / values.length) * 10) / 10 : null,
      maxC: values.length ? Math.max(...values) : null,
      minC: values.length ? Math.min(...values) : null,
      validPixels: values.length,
      totalPixels: total,
      coveragePercent: coverage,
      hotspot: hot && hotPos ? { lat: hotPos.lat, lon: hotPos.lon, valueC: hot.v } : null,
      tileUrlTemplate: tileUrl(layer.id, date),
      note:
        layer.kind === "8-day"
          ? "8-day daytime composite: the clearest view over the period, used when recent passes were cloudy."
          : "Single daytime satellite pass. Clouds and water show no value.",
    };
  }

  /**
   * Newest usable observation for a city: tries the last three days of Terra and Aqua passes and
   * accepts the first with at least 20% clear pixels; otherwise falls back to the 8-day composite.
   */
  async latest(lat: number, lon: number, radiusKm: number): Promise<SatelliteLst | null> {
    const key = `${lat.toFixed(3)},${lon.toFixed(3)},${radiusKm}`;
    const cached = this.results.get(key);
    if (cached !== undefined) return cached;

    const candidates: [LstLayer, string][] = [];
    for (let d = 0; d < 3; d++) {
      candidates.push([LST_LAYERS.MODIS_Terra_Land_Surface_Temp_Day!, isoDay(d)]);
      candidates.push([LST_LAYERS.MODIS_Aqua_Land_Surface_Temp_Day!, isoDay(d)]);
    }
    // Read every recent pass and the recent 8-day composites at once.
    const composite = LST_LAYERS.MODIS_Terra_L3_Land_Surface_Temp_8Day_Day!;
    const [daily, composites] = await Promise.all([
      Promise.all(candidates.map(([layer, date]) => this.read(layer, date, lat, lon, radiusKm).catch(() => null))),
      Promise.all(compositeStarts(4).map((date) => this.read(composite, date, lat, lon, radiusKm).catch(() => null))),
    ]);
    const baseline = composites.find((res) => res && res.validPixels > 0) ?? null;
    // A daily pass is used only when it is clear enough and not much colder than the composite:
    // thin cloud the cloud mask missed shows up as implausibly cold "ground".
    const best =
      daily.find(
        (res) =>
          res &&
          res.coveragePercent >= 30 &&
          res.validPixels >= 5 &&
          (baseline?.meanC == null || (res.meanC ?? -99) >= baseline.meanC - 5),
      ) ?? baseline;
    this.results.set(key, best, best ? 3600_000 : 600_000);
    return best;
  }
}
