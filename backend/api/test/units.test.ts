// Unit tests. Upstream responses below are MOCKED fixtures (test-only), shaped like
// real Open-Meteo / NEA / OpenRouter responses observed on 2026-10-10.
import { describe, expect, it } from "vitest";
import { buildFacts, deterministicExplanation, explain, parseModelJson } from "../src/advice.js";
import { buildAdvisory, getOfficialWarning, shouldSendPushAlert } from "../src/advisory.js";
import { buildArea, circleGeometry } from "../src/area.js";
import { compose } from "../src/app.js";
import { isValidCountryCode, parseResults } from "../src/places.js";
import { emptySatellite, satelliteFromJob } from "../src/satellite.js";
import type { Place, Weather } from "../src/types.js";
import { localToUtcIso, nearestWbgt, normalizeOpenMeteo, type OpenMeteoResponse } from "../src/weather.js";

const delhi: Place = {
  id: "open-meteo:1261481", city: "New Delhi", admin1: "Delhi", admin2: null, country: "India",
  countryCode: "IN", latitude: 28.63576, longitude: 77.22445, timezone: "Asia/Kolkata", population: 317797,
};
const singapore: Place = { ...delhi, id: "open-meteo:1880252", city: "Singapore", admin1: null, country: "Singapore",
  countryCode: "SG", latitude: 1.28967, longitude: 103.85007, timezone: "Asia/Singapore" };

function meteo(overrides: Partial<OpenMeteoResponse> = {}): OpenMeteoResponse {
  return {
    latitude: 28.625, longitude: 77.25, utc_offset_seconds: 19800, timezone: "Asia/Kolkata",
    current_units: { temperature_2m: "°C", relative_humidity_2m: "%", apparent_temperature: "°C", wind_speed_10m: "km/h" },
    current: { time: "2026-10-10T14:00", temperature_2m: 33.1, relative_humidity_2m: 40, apparent_temperature: 35.2, wind_speed_10m: 7.9 },
    hourly_units: { temperature_2m: "°C", relative_humidity_2m: "%", apparent_temperature: "°C" },
    hourly: {
      time: ["2026-10-10T14:00", "2026-10-10T15:00", "2026-10-10T16:00"],
      temperature_2m: [33.1, 33.6, null],
      relative_humidity_2m: [40, 38, null],
      apparent_temperature: [35.2, 36.4, null],
    },
    ...overrides,
  };
}
const NOW = new Date("2026-10-10T08:40:00Z"); // 14:10 IST

describe("places", () => {
  it("validates ISO country codes", () => {
    expect(isValidCountryCode("IN")).toBe(true);
    expect(isValidCountryCode("XX")).toBe(false);
    expect(isValidCountryCode("in")).toBe(false);
  });

  it("keeps identical city names from different countries apart and filters by country", () => {
    const raw = [
      { id: 2643743, name: "London", latitude: 51.5, longitude: -0.12, country_code: "GB", country: "United Kingdom", admin1: "England", timezone: "Europe/London" },
      { id: 6058560, name: "London", latitude: 42.98, longitude: -81.23, country_code: "CA", country: "Canada", admin1: "Ontario", timezone: "America/Toronto" },
    ];
    const ca = parseResults(raw, "CA", "en");
    expect(ca).toHaveLength(1);
    expect(ca[0]!.id).toBe("open-meteo:6058560");
    expect(ca[0]!.admin1).toBe("Ontario");
    expect(parseResults(raw, "GB", "en")[0]!.id).toBe("open-meteo:2643743");
  });

  it("handles missing optional fields and drops malformed entries", () => {
    const raw = [
      { id: 1, name: "Smalltown", latitude: 10, longitude: 20, country_code: "IN" },
      { id: 2, name: "Bad", latitude: 200, longitude: 20, country_code: "IN" },
      { name: "NoId", latitude: 1, longitude: 2, country_code: "IN" },
    ];
    const res = parseResults(raw, "IN", "en");
    expect(res).toHaveLength(1);
    expect(res[0]).toMatchObject({ admin1: null, admin2: null, timezone: null, population: null, country: "India" });
  });

  it("treats no matches as an empty list", () => {
    expect(parseResults([], "IN", "en")).toEqual([]);
  });
});

describe("area", () => {
  it("builds a closed [lon, lat] polygon around the centre", () => {
    const a = buildArea(28.6, 77.2, 15);
    expect(a.label).toBe("City-centre area");
    expect(a.geometry.type).toBe("Polygon");
    const ring = (a.geometry.coordinates as number[][][])[0]!;
    expect(ring[0]).toEqual(ring.at(-1));
    const lons = ring.map((p) => p[0]!);
    const lats = ring.map((p) => p[1]!);
    expect(Math.min(...lons)).toBeGreaterThan(76.9); // longitude first
    expect(Math.max(...lats)).toBeCloseTo(28.6 + 15 / 110.9, 1);
  });

  it("splits a circle crossing the antimeridian into a MultiPolygon within ±180", () => {
    const g = circleGeometry(-17, 179.95, 15_000);
    expect(g.type).toBe("MultiPolygon");
    const all = (g.coordinates as number[][][][]).flat(2);
    expect(all.every(([lon]) => lon! >= -180 && lon! <= 180)).toBe(true);
  });

  it("handles high latitudes", () => {
    const g = circleGeometry(78.22, 15.65, 15_000); // Longyearbyen
    const ring = (g.coordinates as number[][][])[0]!;
    const lons = ring.map((p) => p[0]!);
    expect(Math.max(...lons) - Math.min(...lons)).toBeGreaterThan(1); // ~0.6° per 15 km at 78°N
  });
});

describe("weather", () => {
  it("converts local times to UTC", () => {
    expect(localToUtcIso("2026-10-10T14:00", 19800)).toBe("2026-10-10T08:30:00.000Z");
    expect(localToUtcIso("garbage", 0)).toBeNull();
  });

  it("normalizes a valid response and keeps nulls as null", () => {
    const w = normalizeOpenMeteo(meteo(), delhi, NOW, 3 * 3600_000);
    expect(w.status).toBe("available");
    expect(w.dataType).toBe("modelled");
    expect(w.validAt).toBe("2026-10-10T08:30:00.000Z");
    expect(w.hourly[2]!.temperatureC).toBeNull();
  });

  it("rejects inconsistent hourly arrays", () => {
    const body = meteo();
    body.hourly.apparent_temperature = [35.2];
    expect(normalizeOpenMeteo(body, delhi, NOW, 3 * 3600_000).status).toBe("error");
  });

  it("rejects wrong units and mismatched coordinates", () => {
    expect(normalizeOpenMeteo(meteo({ current_units: { temperature_2m: "°F" } }), delhi, NOW, 1e9).status).toBe("error");
    expect(normalizeOpenMeteo(meteo({ latitude: 77.2, longitude: 28.6 }), delhi, NOW, 1e9).status).toBe("error");
  });

  it("marks old data stale", () => {
    const later = new Date("2026-10-10T14:00:00Z");
    expect(normalizeOpenMeteo(meteo(), delhi, later, 3 * 3600_000).status).toBe("stale");
  });

  it("picks the nearest NEA WBGT station and records distance", () => {
    const obs = nearestWbgt(
      { code: 0, data: { records: [{ datetime: "2026-10-10T10:30:00+08:00", item: { readings: [
        { station: { id: "S124", name: "Upper Changi Road North" }, location: { latitude: "1.36777", longitude: "103.982262" }, wbgt: "30.4", heatStress: "Low" },
        { station: { id: "S127", name: "Stadium Road" }, location: { latitude: "1.305738", longitude: "103.878174" }, wbgt: "31.8", heatStress: "Moderate" },
      ] } }] } },
      singapore,
      new Date("2026-10-10T02:40:00Z"),
    );
    expect(obs.stationId).toBe("S127");
    expect(obs.status).toBe("available");
    expect(obs.stationDistanceKm).toBeGreaterThan(3);
    expect(obs.stationDistanceKm).toBeLessThan(4);
  });
});

function weatherOk(): Weather {
  return normalizeOpenMeteo(meteo(), delhi, NOW, 3 * 3600_000);
}

describe("advisory", () => {
  it("is unclassified (not a fabricated band) where no documented scheme exists", () => {
    const a = buildAdvisory(delhi, weatherOk(), null, NOW);
    expect(a.classification).toBe("unclassified");
    expect(a.label).toBe("UrbanHeat Watch advisory — not an official warning");
    expect(a.basis.map((b) => b.metric).join(" ")).not.toMatch(/WBGT|heat index/i);
  });

  it("uses the NEA-published category in Singapore", () => {
    const wbgt = { status: "available" as const, provider: "NEA", dataType: "station_observation" as const, stationId: "S127",
      stationName: "Stadium Road", stationDistanceKm: 3.4, wbgtC: 33.2, heatStressCategory: "High",
      observedAt: "2026-10-10T02:30:00.000Z", fetchedAt: null, representativeness: "", message: null };
    const a = buildAdvisory(singapore, weatherOk(), wbgt, NOW);
    expect(a.classification).toBe("high");
    expect(a.ruleId).toBe("SG-NEA-WBGT-CATEGORY");
  });

  it("returns unknown, not safe, when data is missing or stale", () => {
    const stale = { ...weatherOk(), status: "stale" as const };
    const a = buildAdvisory(delhi, stale, null, NOW);
    expect(a.classification).toBe("unknown");
    expect(a.dataFreshness).toBe("stale");
    expect(buildAdvisory(delhi, { ...weatherOk(), status: "error" }, null, NOW).dataFreshness).toBe("missing");
  });

  it("never pushes from stale or unclassified data", () => {
    const high = { ...buildAdvisory(delhi, weatherOk(), null, NOW), classification: "high" as const, validUntil: null };
    expect(shouldSendPushAlert(high, null, NOW)).toBe(true);
    expect(shouldSendPushAlert({ ...high, dataFreshness: "stale" }, null, NOW)).toBe(false);
    expect(shouldSendPushAlert({ ...high, classification: "unclassified" }, null, NOW)).toBe(false);
    expect(shouldSendPushAlert(high, "high", NOW)).toBe(false);
  });

  it("reports missing official-warning provider without implying no warning", async () => {
    const w = await getOfficialWarning(delhi, []);
    expect(w.status).toBe("provider_not_configured");
    expect(w.message).toMatch(/does not mean no official warning/);
  });
});

function env() {
  return compose(
    {
      requestId: "00000000-0000-4000-8000-000000000000", place: delhi, area: buildArea(delhi.latitude, delhi.longitude, 15),
      weather: weatherOk(), wbgt: null,
      officialWarning: { status: "provider_not_configured", message: "", warning: null },
      jobId: null, satelliteFallback: emptySatellite("unavailable", null), advice: null,
    },
    emptySatellite("partial_coverage", "cloudy"),
  );
}

function fakeFetch(content: string | null, status = 200): typeof fetch {
  return (async () =>
    new Response(JSON.stringify({ choices: [{ message: { content } }] }), { status })) as unknown as typeof fetch;
}

describe("AI explanation", () => {
  const deps = { apiKey: "test-key", model: "test/model", timeoutMs: 1000 };

  it("accepts valid JSON and attaches the server classification", async () => {
    const out = await explain(env(), { ...deps, fetchImpl: fakeFetch(JSON.stringify({
      headline: "Hot afternoon", explanation: "x", precautions: ["Drink water"], limitations: ["Cloudy"] })) });
    expect(out.source).toBe("ai");
    expect(out.classification).toBe("unclassified");
  });

  it("cannot change the classification even if the model tries", async () => {
    const out = await explain(env(), { ...deps, fetchImpl: fakeFetch(JSON.stringify({
      headline: "h", explanation: "e", precautions: [], limitations: [], classification: "high" })) });
    // Extra keys fail the strict schema -> deterministic fallback with the real classification.
    expect(out.source).toBe("deterministic_fallback");
    expect(out.classification).toBe("unclassified");
  });

  it("falls back on malformed output, HTTP errors, timeouts and missing key", async () => {
    expect((await explain(env(), { ...deps, fetchImpl: fakeFetch("not json") })).fallbackReason).toBe("ai_invalid_output");
    expect((await explain(env(), { ...deps, fetchImpl: fakeFetch(null, 500) })).fallbackReason).toBe("ai_http_500");
    const timeout = (async () => { const e = new Error("t"); e.name = "TimeoutError"; throw e; }) as unknown as typeof fetch;
    expect((await explain(env(), { ...deps, fetchImpl: timeout })).fallbackReason).toBe("ai_timeout");
    expect((await explain(env(), { ...deps, apiKey: undefined })).fallbackReason).toBe("ai_not_configured");
  });

  it("deterministic text distinguishes surface and air temperature and states partial coverage", () => {
    const d = deterministicExplanation(env(), "test");
    expect(d.explanation).toMatch(/Modelled air temperature is 33.1/);
    expect(d.explanation).toMatch(/coverage was too limited/);
  });

  it("strips code fences but rejects non-JSON", () => {
    expect(parseModelJson('```json\n{"headline":"a","explanation":"b","precautions":[],"limitations":[]}\n```')).not.toBeNull();
    expect(parseModelJson("Sure! here is")).toBeNull();
  });

  it("sends only the needed facts", () => {
    const facts = JSON.stringify(buildFacts(env()));
    expect(facts).not.toMatch(/requestId|placeId|latitude/);
  });
});

describe("satellite mapping", () => {
  it("maps processing and completed jobs", () => {
    expect(satelliteFromJob({ jobId: "a".repeat(32), status: "processing" }).status).toBe("processing");
    const s = satelliteFromJob(
      { jobId: "a".repeat(32), status: "completed", result: { status: "configuration_required", note: "creds", layer: null,
        productsConsidered: [{ id: "S3A" }], searchWindowHours: 72, limitations: [] } },
    );
    expect(s.status).toBe("configuration_required");
    expect(s.summary).toBeNull();
    expect(s.tileUrlTemplate).toBeNull();
  });
});

import { COUNTRY_BBOX, gridFor } from "../src/heatgrid.js";

describe("heat grid", () => {
  it("covers the bbox with at most 144 points inside it", () => {
    for (const { bbox } of Object.values(COUNTRY_BBOX)) {
      const g = gridFor(bbox);
      expect(g.points.length).toBeLessThanOrEqual(144);
      expect(g.points.length).toBe(g.rows * g.cols);
      for (const p of g.points) {
        expect(p.lon).toBeGreaterThan(bbox[0]);
        expect(p.lon).toBeLessThan(bbox[2]);
        expect(p.lat).toBeGreaterThan(bbox[1]);
        expect(p.lat).toBeLessThan(bbox[3]);
      }
    }
  });
});
