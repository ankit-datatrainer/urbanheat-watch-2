import type {
  Advisory,
  AdvisoryBasis,
  AdvisoryClassification,
  OfficialWarning,
  Place,
  WbgtObservation,
  Weather,
} from "./types.js";

/**
 * Deterministic UrbanHeat Watch advisory rules.
 *
 * Only documented, country-specific schemes produce a risk band. Satellite land-surface
 * temperature is never used for human heat-stress classification, and apparent
 * temperature is never relabelled as WBGT or heat index.
 */

const LABEL = "UrbanHeat Watch advisory — not an official warning" as const;

export const GENERAL_PRECAUTIONS = [
  "Drink water regularly, even before you feel thirsty.",
  "Plan strenuous outdoor activity for the cooler early morning or evening.",
  "Rest in shade or air-conditioned spaces during the hottest hours.",
  "Check on older adults, young children and people with health conditions.",
  "Seek medical help for confusion, fainting, or hot skin that has stopped sweating.",
];

const SG_PRECAUTIONS: Record<"low" | "moderate" | "high", string[]> = {
  low: ["Normal outdoor activity is fine; keep hydrated and take shade breaks."],
  moderate: [
    "Reduce prolonged or strenuous outdoor activity and take more frequent rest breaks.",
    "Drink water regularly and rest in shade or indoors.",
  ],
  high: [
    "Avoid or postpone strenuous outdoor activity, especially between late morning and late afternoon.",
    "Stay in shade or air-conditioned spaces where possible and drink water regularly.",
  ],
};

const NEA_CATEGORY: Record<string, "low" | "moderate" | "high"> = {
  low: "low",
  moderate: "moderate",
  high: "high",
};

export const RULES = {
  sgNea: { id: "SG-NEA-WBGT-CATEGORY", version: "1.0.0" },
  unclassified: { id: "GENERIC-NO-DOCUMENTED-SCHEME", version: "1.0.0" },
  unknown: { id: "NO-USABLE-DATA", version: "1.0.0" },
};

function forecastMaxApparent(weather: Weather, now: Date, hours = 24) {
  const end = now.getTime() + hours * 3600_000;
  let max: { value: number; time: string } | null = null;
  for (const h of weather.hourly) {
    const t = Date.parse(h.time);
    if (t < now.getTime() - 3600_000 || t > end || h.apparentTemperatureC === null) continue;
    if (!max || h.apparentTemperatureC > max.value) max = { value: h.apparentTemperatureC, time: h.time };
  }
  return max;
}

export function buildAdvisory(
  place: Place,
  weather: Weather,
  wbgt: WbgtObservation | null,
  now: Date = new Date(),
): Advisory {
  // 1. Singapore: NEA publishes an official WBGT heat-stress category per station.
  if (place.countryCode === "SG" && wbgt?.status === "available" && wbgt.heatStressCategory && wbgt.observedAt) {
    const cls = NEA_CATEGORY[wbgt.heatStressCategory.trim().toLowerCase()];
    if (cls) {
      const validUntil = new Date(Date.parse(wbgt.observedAt) + 60 * 60_000).toISOString();
      return {
        classification: cls,
        label: LABEL,
        ruleId: RULES.sgNea.id,
        ruleVersion: RULES.sgNea.version,
        thresholdBasis:
          "Heat-stress category as published by Singapore's NEA for the nearest WBGT station " +
          "(NEA bands: Low < 31 °C, Moderate 31–< 33 °C, High ≥ 33 °C WBGT). UrbanHeat Watch does not recompute it.",
        basis: [
          {
            metric: "WBGT (station observation)",
            value: wbgt.wbgtC,
            units: "°C",
            source: wbgt.provider,
            observedOrValidAt: wbgt.observedAt,
            detail: `Station ${wbgt.stationName} (${wbgt.stationId}), ${wbgt.stationDistanceKm} km from the city centre`,
          },
        ],
        validFrom: wbgt.observedAt,
        validUntil,
        dataFreshness: "fresh",
        headline: `${cls[0]!.toUpperCase()}${cls.slice(1)} heat stress (NEA WBGT category)`,
        precautions: SG_PRECAUTIONS[cls],
      };
    }
  }

  // 2. Fresh modelled weather but no documented scheme for this country: show data, no band.
  if (weather.status === "available") {
    const basis: AdvisoryBasis[] = [];
    if (weather.apparentTemperatureC !== null) {
      basis.push({
        metric: "Apparent temperature (modelled, current)",
        value: weather.apparentTemperatureC,
        units: "°C",
        source: weather.provider,
        observedOrValidAt: weather.validAt,
      });
    }
    const max = forecastMaxApparent(weather, now);
    if (max) {
      basis.push({
        metric: "Maximum apparent temperature, next 24 h (modelled forecast)",
        value: max.value,
        units: "°C",
        source: weather.provider,
        observedOrValidAt: max.time,
      });
    }
    const last = weather.hourly.at(-1)?.time ?? null;
    return {
      classification: "unclassified",
      label: LABEL,
      ruleId: RULES.unclassified.id,
      ruleVersion: RULES.unclassified.version,
      thresholdBasis:
        `No documented heat-stress classification scheme is configured for ${place.country}. ` +
        "Forecast values are shown without a risk band.",
      basis,
      validFrom: weather.validAt,
      validUntil: last,
      dataFreshness: "fresh",
      headline: "Heat risk not classified for this location",
      precautions: GENERAL_PRECAUTIONS,
    };
  }

  // 3. Missing or stale data is "unknown", never "safe".
  return {
    classification: "unknown",
    label: LABEL,
    ruleId: RULES.unknown.id,
    ruleVersion: RULES.unknown.version,
    thresholdBasis: "Current heat data is unavailable or out of date.",
    basis: [],
    validFrom: null,
    validUntil: null,
    dataFreshness: weather.status === "stale" || wbgt?.status === "stale" ? "stale" : "missing",
    headline: "Heat conditions unknown — data unavailable",
    precautions: GENERAL_PRECAUTIONS,
  };
}

// ---------------------------------------------------------------- official warnings

export interface OfficialWarningProvider {
  readonly countryCodes: string[];
  fetch(place: Place, signal?: AbortSignal): Promise<OfficialWarning>;
}

/** No authoritative warning feed is integrated yet. Register providers here. */
export const OFFICIAL_WARNING_PROVIDERS: OfficialWarningProvider[] = [];

export async function getOfficialWarning(
  place: Place,
  providers: OfficialWarningProvider[] = OFFICIAL_WARNING_PROVIDERS,
  signal?: AbortSignal,
): Promise<OfficialWarning> {
  const provider = providers.find((p) => p.countryCodes.includes(place.countryCode));
  if (!provider) {
    return {
      status: "provider_not_configured",
      message:
        "Official warning coverage unavailable for this location. This does not mean no official warning " +
        "is in effect — check your national weather or health authority.",
      warning: null,
    };
  }
  try {
    return await provider.fetch(place, signal);
  } catch {
    return { status: "error", message: "Could not reach the official warning provider.", warning: null };
  }
}

// ---------------------------------------------------------------- push gating

const RANK: Record<AdvisoryClassification, number> = { unknown: -1, unclassified: -1, low: 0, moderate: 1, high: 2 };

/**
 * Whether an advisory may trigger a new push notification. Stale, missing or
 * unclassified data never does; only a fresh escalation to moderate/high.
 */
export function shouldSendPushAlert(
  advisory: Advisory,
  previous: AdvisoryClassification | null,
  now: Date = new Date(),
): boolean {
  if (advisory.dataFreshness !== "fresh") return false;
  if (advisory.validUntil && Date.parse(advisory.validUntil) < now.getTime()) return false;
  if (RANK[advisory.classification] < RANK.moderate) return false;
  return previous === null || RANK[advisory.classification] > RANK[previous];
}
