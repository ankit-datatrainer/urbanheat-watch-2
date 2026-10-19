import { z } from "zod";
import { fetchJson, HttpError } from "./http.js";
import type { Satellite, SatelliteSummary, SourceStatus } from "./types.js";

/** Client for the internal Python geospatial worker. CDSE credentials never leave it. */

const layerSchema = z
  .object({
    layerId: z.string(),
    status: z.string(),
    productId: z.string(),
    collectionId: z.string(),
    platform: z.string().nullable(),
    timeliness: z.string(),
    acquisitionStart: z.string(),
    acquisitionEnd: z.string(),
    acquisitionTimeBasis: z.string(),
    dayNight: z.string(),
    nativeResolutionMeters: z.number(),
    boundsWgs84: z.array(z.number()).length(4),
    coverage: z.record(z.string(), z.unknown()),
    summary: z.record(z.string(), z.unknown()).nullable(),
    partialSummary: z.record(z.string(), z.unknown()).nullable(),
    qualityMask: z.record(z.string(), z.unknown()),
    legend: z.record(z.string(), z.unknown()),
  })
  .loose();

const jobSchema = z.object({
  jobId: z.string(),
  status: z.enum(["queued", "processing", "completed", "failed", "expired", "cancelled"]),
  updatedAt: z.string().optional(),
  error: z.string().nullable().optional(),
  result: z
    .object({
      status: z.string(),
      note: z.string().nullable(),
      layer: layerSchema.nullable(),
      productsConsidered: z.array(z.unknown()),
      searchWindowHours: z.number().nullable(),
      limitations: z.array(z.string()),
    })
    .nullable()
    .optional(),
});
export type WorkerJob = z.infer<typeof jobSchema>;

const valueSchema = z.object({
  insideLayer: z.boolean(),
  valueC: z.number().nullable(),
  quality: z.string(),
  units: z.string().optional(),
  variable: z.string().optional(),
  acquisitionStart: z.string().optional(),
  acquisitionEnd: z.string().optional(),
  nativeResolutionMeters: z.number().optional(),
  productId: z.string().optional(),
});

const KNOWN: SourceStatus[] = ["available", "partial_coverage", "unavailable", "configuration_required", "error"];

export function emptySatellite(status: SourceStatus, message: string | null, jobId: string | null = null): Satellite {
  return {
    status,
    provider: "Copernicus CDSE",
    variable: "Satellite land-surface temperature",
    jobId,
    collectionId: null,
    productIds: [],
    platform: null,
    timeliness: null,
    acquisitionStart: null,
    acquisitionEnd: null,
    acquisitionTimeBasis: null,
    freshness: null,
    dayNight: null,
    nativeResolutionMeters: null,
    validAreaPercent: null,
    validLandAreaPercent: null,
    landQaPassPercent: null,
    validPixelCount: null,
    coverage: null,
    summary: null,
    partialSummary: null,
    qualityMask: null,
    layerId: null,
    tileUrlTemplate: null,
    valueUrl: null,
    boundsWgs84: null,
    legend: null,
    productsConsidered: [],
    message,
    limitations: [],
  };
}

const numOrNull = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : null);

/** Map a worker job onto the public satellite section. */
export function satelliteFromJob(job: WorkerJob, now: Date = new Date()): Satellite {
  if (job.status === "queued" || job.status === "processing") {
    return emptySatellite("processing", "Satellite processing in progress.", job.jobId);
  }
  if (job.status === "failed") return emptySatellite("error", "Satellite processing failed.", job.jobId);
  if (job.status === "expired" || job.status === "cancelled" || !job.result) {
    return emptySatellite("unavailable", `Satellite job ${job.status}.`, job.jobId);
  }
  const r = job.result;
  const status = (KNOWN as string[]).includes(r.status) ? (r.status as SourceStatus) : "error";
  const base = { ...emptySatellite(status, r.note, job.jobId), productsConsidered: r.productsConsidered, limitations: r.limitations };
  const layer = r.layer;
  if (!layer) return base;
  const cov = layer.coverage;
  const ageMs = now.getTime() - Date.parse(layer.acquisitionEnd);
  return {
    ...base,
    collectionId: layer.collectionId,
    productIds: [layer.productId],
    platform: layer.platform,
    timeliness: layer.timeliness,
    acquisitionStart: layer.acquisitionStart,
    acquisitionEnd: layer.acquisitionEnd,
    acquisitionTimeBasis: layer.acquisitionTimeBasis,
    freshness: ageMs > 72 * 3600_000 ? "older_than_72h" : "within_72h",
    dayNight: layer.dayNight,
    nativeResolutionMeters: layer.nativeResolutionMeters,
    validAreaPercent: numOrNull(cov.validAreaPercent),
    validLandAreaPercent: numOrNull(cov.validLandAreaPercent),
    landQaPassPercent: numOrNull(cov.landQaPassPercent),
    validPixelCount: numOrNull(cov.validPixelCount),
    coverage: cov,
    summary: layer.summary as SatelliteSummary | null,
    partialSummary: layer.partialSummary as SatelliteSummary | null,
    qualityMask: layer.qualityMask,
    layerId: layer.layerId,
    tileUrlTemplate: `/api/v1/heatmap/${layer.layerId}/{z}/{x}/{y}.png`,
    valueUrl: `/api/v1/heatmap/${layer.layerId}/value`,
    boundsWgs84: layer.boundsWgs84,
    legend: layer.legend,
  };
}

export interface SatelliteService {
  submit(lat: number, lon: number, radiusKm: number): Promise<WorkerJob>;
  getJob(jobId: string): Promise<WorkerJob>;
  tile(layerId: string, z: number, x: number, y: number): Promise<Response>;
  value(layerId: string, lat: number, lng: number): Promise<z.infer<typeof valueSchema>>;
}

export class WorkerClient implements SatelliteService {
  constructor(
    private baseUrl: string,
    private token: string | undefined,
  ) {}

  private headers(extra: Record<string, string> = {}): Record<string, string> {
    return this.token ? { ...extra, "X-Worker-Token": this.token } : extra;
  }

  submit(lat: number, lon: number, radiusKm: number) {
    return fetchJson(`${this.baseUrl}/jobs`, jobSchema, {
      source: "Geospatial worker",
      timeoutMs: 8000,
      retries: 1,
      init: {
        method: "POST",
        headers: this.headers({ "Content-Type": "application/json" }),
        body: JSON.stringify({ latitude: lat, longitude: lon, radiusKm, areaMode: "city-centre" }),
      },
    });
  }

  getJob(jobId: string) {
    if (!/^[a-f0-9]{32}$/.test(jobId)) throw new HttpError("invalid job id", 400, "Geospatial worker");
    return fetchJson(`${this.baseUrl}/jobs/${jobId}`, jobSchema, {
      source: "Geospatial worker",
      timeoutMs: 5000,
      init: { headers: this.headers() },
    });
  }

  async tile(layerId: string, z: number, x: number, y: number) {
    return fetch(`${this.baseUrl}/layers/${layerId}/tiles/${z}/${x}/${y}.png`, {
      headers: this.headers(),
      signal: AbortSignal.timeout(15_000),
    });
  }

  value(layerId: string, lat: number, lng: number) {
    return fetchJson(`${this.baseUrl}/layers/${layerId}/value?lat=${lat}&lng=${lng}`, valueSchema, {
      source: "Geospatial worker",
      timeoutMs: 5000,
      retries: 0,
      init: { headers: this.headers() },
    });
  }
}
