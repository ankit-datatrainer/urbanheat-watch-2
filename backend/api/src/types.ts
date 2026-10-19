// Normalized API contract. Mirrored for the mobile client in lib/cityEnvironment/types.ts.

export type SourceStatus =
  | "available"
  | "processing"
  | "stale"
  | "partial_coverage"
  | "unavailable"
  | "configuration_required"
  | "error";

export type Place = {
  id: string; // provider-scoped stable ID, e.g. "open-meteo:1261481"
  city: string;
  admin1: string | null;
  admin2: string | null;
  country: string;
  countryCode: string;
  latitude: number;
  longitude: number;
  timezone: string | null;
  population: number | null;
};

export type GeoJsonGeometry =
  | { type: "Polygon"; coordinates: number[][][] }
  | { type: "MultiPolygon"; coordinates: number[][][][] };

export type Area = {
  mode: "city-centre";
  radiusKm: number;
  geometry: GeoJsonGeometry;
  label: "City-centre area";
  areaKm2: number;
  note: string;
};

export type HourlyPoint = {
  time: string; // ISO 8601 UTC
  temperatureC: number | null;
  relativeHumidityPercent: number | null;
  apparentTemperatureC: number | null;
};

export type Weather = {
  status: SourceStatus;
  dataType: "modelled";
  provider: string;
  validAt: string | null;
  fetchedAt: string | null;
  gridLatitude: number | null;
  gridLongitude: number | null;
  temperatureC: number | null;
  relativeHumidityPercent: number | null;
  apparentTemperatureC: number | null;
  windSpeedKmh: number | null;
  hourly: HourlyPoint[];
  message: string | null;
};

export type WbgtObservation = {
  status: SourceStatus;
  provider: string;
  dataType: "station_observation";
  stationId: string | null;
  stationName: string | null;
  stationDistanceKm: number | null;
  wbgtC: number | null;
  heatStressCategory: string | null; // as published by NEA
  observedAt: string | null;
  fetchedAt: string | null;
  representativeness: string;
  message: string | null;
};

export type SatelliteSummary = {
  minC: number;
  meanC: number;
  medianC: number;
  maxC: number;
  p90C: number;
  areaWeighting: string;
  scope?: string;
};

export type Satellite = {
  status: SourceStatus;
  provider: "Copernicus CDSE";
  variable: "Satellite land-surface temperature";
  jobId: string | null;
  collectionId: string | null;
  productIds: string[];
  platform: string | null;
  timeliness: string | null;
  acquisitionStart: string | null;
  acquisitionEnd: string | null;
  acquisitionTimeBasis: string | null;
  freshness: "within_72h" | "older_than_72h" | null;
  dayNight: string | null;
  nativeResolutionMeters: number | null;
  validAreaPercent: number | null;
  validLandAreaPercent: number | null;
  landQaPassPercent: number | null;
  validPixelCount: number | null;
  coverage: Record<string, unknown> | null;
  summary: SatelliteSummary | null;
  partialSummary: SatelliteSummary | null;
  qualityMask: Record<string, unknown> | null;
  layerId: string | null;
  tileUrlTemplate: string | null;
  valueUrl: string | null;
  boundsWgs84: number[] | null;
  legend: Record<string, unknown> | null;
  productsConsidered: unknown[];
  message: string | null;
  limitations: string[];
};

export type OfficialWarning = {
  status: "available" | "none_in_effect" | "provider_not_configured" | "error";
  message: string;
  warning: null | {
    issuer: string;
    severity: string;
    issuedAt: string;
    expiresAt: string | null;
    area: string;
    text: string;
    url: string | null;
  };
};

export type AdvisoryClassification = "low" | "moderate" | "high" | "unclassified" | "unknown";

export type AdvisoryBasis = {
  metric: string;
  value: number | string | null;
  units: string | null;
  source: string;
  observedOrValidAt: string | null;
  detail?: string;
};

export type Advisory = {
  classification: AdvisoryClassification;
  label: "UrbanHeat Watch advisory — not an official warning";
  ruleId: string;
  ruleVersion: string;
  thresholdBasis: string;
  basis: AdvisoryBasis[];
  validFrom: string | null;
  validUntil: string | null;
  dataFreshness: "fresh" | "stale" | "missing";
  headline: string;
  precautions: string[];
};

export type AiExplanation = {
  source: "ai" | "deterministic_fallback";
  model: string | null;
  headline: string;
  explanation: string;
  precautions: string[];
  limitations: string[];
  // Attached by the server, never taken from model output.
  classification: AdvisoryClassification;
  generatedAt: string;
  fallbackReason?: string;
};

export type Source = { id: string; name: string; url: string; attribution: string; dataType: string };

export type CityEnvironment = {
  requestId: string;
  place: Place;
  area: Area;
  weather: Weather;
  wbgt: WbgtObservation | null;
  satellite: Satellite;
  officialWarning: OfficialWarning;
  advisory: Advisory;
  aiExplanation: AiExplanation | null;
  sources: Source[];
  limitations: string[];
};
