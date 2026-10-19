// Live-conditions unit tests. Upstream responses are MOCKED fixtures shaped like real
// NEA (data.gov.sg v2) and aviationweather.gov METAR JSON observed on 2026-10-16.
import { describe, expect, it } from "vitest";
import { humidityFromDewPoint, nearestMetar, nearestNea } from "../src/live.js";

const now = Date.parse("2026-10-16T13:50:00Z");
const metar = (icaoId: string, lat: number, lon: number, obsIso: string, temp: number | null = 29, dewp: number | null = 25) => ({
  icaoId, name: `${icaoId} Arpt, XX`, obsTime: Date.parse(obsIso) / 1000, temp, dewp, lat, lon,
});

describe("humidityFromDewPoint", () => {
  it("is 100% when dew point equals temperature", () => {
    expect(humidityFromDewPoint(25, 25)).toBe(100);
  });
  it("matches a typical tropical evening reading", () => {
    expect(humidityFromDewPoint(29, 25)).toBe(79);
  });
});

describe("nearestMetar", () => {
  it("picks the closest fresh report with temperature and dew point", () => {
    const best = nearestMetar(
      [
        metar("FAR", 1.6, 104.1, "2026-10-16T13:30:00Z"),
        metar("NEAR", 1.36, 103.99, "2026-10-16T13:30:00Z"),
        metar("NOTEMP", 1.35, 103.82, "2026-10-16T13:30:00Z", null),
      ],
      1.3521, 103.8198, now,
    );
    expect(best?.m.icaoId).toBe("NEAR");
  });
  it("keeps the newest report from the same station", () => {
    const best = nearestMetar(
      [metar("WSSS", 1.36, 103.99, "2026-10-16T13:00:00Z", 30), metar("WSSS", 1.36, 103.99, "2026-10-16T13:30:00Z", 29)],
      1.3521, 103.8198, now,
    );
    expect(best?.m.temp).toBe(29);
  });
  it("ignores stale or distant reports", () => {
    expect(nearestMetar([metar("OLD", 1.36, 103.99, "2026-10-16T10:00:00Z")], 1.3521, 103.8198, now)).toBeNull();
    expect(nearestMetar([metar("FAR", 3.1, 101.5, "2026-10-16T13:30:00Z")], 1.3521, 103.8198, now)).toBeNull();
  });
});

describe("nearestNea", () => {
  it("returns the nearest station's latest value", () => {
    const body = {
      data: {
        stations: [
          { id: "S109", name: "Ang Mo Kio Avenue 5", location: { latitude: 1.3793, longitude: 103.85 } },
          { id: "S24", name: "Changi", location: { latitude: 1.3678, longitude: 103.9826 } },
        ],
        readings: [{ timestamp: "2026-10-16T21:48:00+08:00", data: [{ stationId: "S109", value: 29.3 }, { stationId: "S24", value: 28.8 }] }],
      },
    };
    const r = nearestNea(body, 1.3521, 103.8198);
    expect(r?.name).toBe("Ang Mo Kio Avenue 5");
    expect(r?.value).toBe(29.3);
    expect(r?.observedAt).toBe("2026-10-16T13:48:00.000Z");
  });
});
