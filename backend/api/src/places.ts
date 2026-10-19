import countries from "i18n-iso-countries";
import { z } from "zod";
import { TtlCache } from "./cache.js";
import { fetchJson } from "./http.js";
import type { Place } from "./types.js";

// Open-Meteo geocoding (GeoNames-based). https://open-meteo.com/en/docs/geocoding-api
const GEOCODING_BASE = "https://geocoding-api.open-meteo.com/v1";
const PROVIDER_PREFIX = "open-meteo:";

const geoResult = z.object({
  id: z.number().int(),
  name: z.string().min(1),
  latitude: z.number().min(-90).max(90),
  longitude: z.number().min(-180).max(180),
  country_code: z.string().length(2).optional(),
  country: z.string().optional(),
  admin1: z.string().optional(),
  admin2: z.string().optional(),
  timezone: z.string().optional(),
  population: z.number().nonnegative().optional(),
  feature_code: z.string().optional(),
});
type GeoResult = z.infer<typeof geoResult>;

// "No matches" is a response without a `results` key, not an error.
const searchResponse = z.object({ results: z.array(z.unknown()).optional() });

export function isValidCountryCode(code: string): boolean {
  return /^[A-Z]{2}$/.test(code) && countries.isValid(code);
}

export function normalizeResult(r: GeoResult, language = "en"): Place | null {
  const code = r.country_code?.toUpperCase();
  if (!code) return null;
  return {
    id: `${PROVIDER_PREFIX}${r.id}`,
    city: r.name,
    admin1: r.admin1 ?? null,
    admin2: r.admin2 ?? null,
    country: r.country ?? countries.getName(code, language) ?? countries.getName(code, "en") ?? code,
    countryCode: code,
    latitude: r.latitude,
    longitude: r.longitude,
    timezone: r.timezone ?? null,
    population: r.population ?? null,
  };
}

/** Validate each result individually so one malformed entry does not drop the list. */
export function parseResults(raw: unknown[], countryCode: string, language: string): Place[] {
  const out: Place[] = [];
  for (const item of raw) {
    const parsed = geoResult.safeParse(item);
    if (!parsed.success) continue;
    const place = normalizeResult(parsed.data, language);
    // Defensive: enforce the selected country even though the API filters too.
    if (place && place.countryCode === countryCode) out.push(place);
  }
  return out;
}

export class PlaceService {
  private searchCache = new TtlCache<Place[]>(10 * 60_000, 2000);
  private placeCache = new TtlCache<Place>(24 * 3600_000, 5000);

  async search(q: string, countryCode: string, language: string, signal?: AbortSignal): Promise<Place[]> {
    const cacheKey = `${countryCode}|${language}|${q.toLowerCase()}`;
    const cached = this.searchCache.get(cacheKey);
    if (cached) return cached;
    const url =
      `${GEOCODING_BASE}/search?name=${encodeURIComponent(q)}&countryCode=${countryCode}` +
      `&count=10&language=${language}&format=json`;
    const body = await fetchJson(url, searchResponse, { source: "Open-Meteo geocoding", timeoutMs: 8000, signal });
    const places = parseResults(body.results ?? [], countryCode, language);
    for (const p of places) this.placeCache.set(p.id, p);
    this.searchCache.set(cacheKey, places);
    return places;
  }

  /** Resolve the canonical place server-side from its stable ID. */
  async get(placeId: string, language = "en"): Promise<Place | null> {
    const cached = this.placeCache.get(placeId);
    if (cached) return cached;
    if (!placeId.startsWith(PROVIDER_PREFIX)) return null;
    const numeric = placeId.slice(PROVIDER_PREFIX.length);
    if (!/^\d{1,12}$/.test(numeric)) return null;
    const url = `${GEOCODING_BASE}/get?id=${numeric}&language=${language}`;
    const body = await fetchJson(url, z.unknown(), { source: "Open-Meteo geocoding", timeoutMs: 8000 });
    const parsed = geoResult.safeParse(body);
    if (!parsed.success) return null;
    const place = normalizeResult(parsed.data, language);
    if (place) this.placeCache.set(place.id, place);
    return place;
  }
}
