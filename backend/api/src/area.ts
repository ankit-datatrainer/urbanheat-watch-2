import geodesic from "geographiclib-geodesic";
import type { Area, GeoJsonGeometry } from "./types.js";

const WGS84 = geodesic.Geodesic.WGS84;

type Pt = [number, number]; // [lon, lat]

/** Geodesic circle vertices (lon unwrapped relative to the centre, so it may exceed ±180). */
export function geodesicRing(lat: number, lon: number, radiusM: number, n = 72): Pt[] {
  const pts: Pt[] = [];
  for (let i = 0; i < n; i++) {
    const r = WGS84.Direct(lat, lon, (360 * i) / n, radiusM);
    const lon2 = r.lon2 ?? lon;
    const unwrapped = (((lon2 - lon + 540) % 360) - 180) + lon;
    pts.push([unwrapped, r.lat2 ?? lat]);
  }
  pts.push(pts[0]!);
  return pts;
}

/** Sutherland–Hodgman clip of a closed ring against the vertical line x = edge. */
function clip(ring: Pt[], edge: number, keepLeft: boolean): Pt[] {
  const inside = (p: Pt) => (keepLeft ? p[0] <= edge : p[0] >= edge);
  const out: Pt[] = [];
  for (let i = 0; i < ring.length - 1; i++) {
    const a = ring[i]!;
    const b = ring[i + 1]!;
    const intersect = (): Pt => {
      const t = (edge - a[0]) / (b[0] - a[0]);
      return [edge, a[1] + t * (b[1] - a[1])];
    };
    if (inside(a)) {
      out.push(a);
      if (!inside(b)) out.push(intersect());
    } else if (inside(b)) {
      out.push(intersect());
    }
  }
  if (out.length) out.push(out[0]!);
  return out;
}

const round = (ring: Pt[]) => ring.map(([x, y]) => [Number(x.toFixed(6)), Number(y.toFixed(6))]);

/** RFC 7946 geometry: rings crossing the antimeridian are split into a MultiPolygon. */
export function circleGeometry(lat: number, lon: number, radiusM: number): GeoJsonGeometry {
  const ring = geodesicRing(lat, lon, radiusM);
  const xs = ring.map((p) => p[0]);
  const west = Math.min(...xs);
  const east = Math.max(...xs);
  if (east > 180) {
    const a = clip(ring, 180, true);
    const b = clip(ring, 180, false).map(([x, y]) => [x - 360, y] as Pt);
    return { type: "MultiPolygon", coordinates: [[round(a)], [round(b)]] };
  }
  if (west < -180) {
    const a = clip(ring, -180, false);
    const b = clip(ring, -180, true).map(([x, y]) => [x + 360, y] as Pt);
    return { type: "MultiPolygon", coordinates: [[round(a)], [round(b)]] };
  }
  return { type: "Polygon", coordinates: [round(ring)] };
}

export function buildArea(lat: number, lon: number, radiusKm: number): Area {
  const radiusM = radiusKm * 1000;
  return {
    mode: "city-centre",
    radiusKm,
    geometry: circleGeometry(lat, lon, radiusM),
    label: "City-centre area",
    areaKm2: Number((Math.PI * radiusKm * radiusKm).toFixed(1)),
    note:
      `A ${radiusKm} km geodesic radius around the geocoded city centre. ` +
      "This is not the administrative city boundary.",
  };
}
