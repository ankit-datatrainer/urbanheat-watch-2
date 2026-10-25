// Server-side configuration. Secrets live only here, never in the mobile bundle.

function str(name: string, fallback?: string): string | undefined {
  const v = process.env[name]?.trim();
  return v ? v : fallback;
}

function num(name: string, fallback: number): number {
  const v = str(name);
  const n = v === undefined ? NaN : Number(v);
  return Number.isFinite(n) ? n : fallback;
}

export type Config = {
  port: number;
  host: string;
  workerUrl: string;
  workerToken: string | undefined;
  openRouterApiKey: string | undefined;
  openRouterModel: string;
  openRouterTimeoutMs: number;
  defaultRadiusKm: number;
  maxRadiusKm: number;
  weatherCacheTtlMs: number;
  weatherStaleAfterMs: number;
  corsOrigins: string[];
  rateLimitPerMinute: number;
  aiRateLimitPerMinute: number;
  aiStreamIdleTimeoutMs: number;
  aiFirstTokenTimeoutMs: number;
  /** Supabase project URL and service-role (or sb_secret_) key for server-side sign-up. */
  supabaseUrl?: string;
  supabaseServiceKey?: string;
  signupRateLimitPerHour?: number;
};

export function loadConfig(): Config {
  return {
    port: num("PORT", 8787),
    host: str("HOST", "0.0.0.0")!,
    workerUrl: str("WORKER_URL", "http://127.0.0.1:8790")!.replace(/\/$/, ""),
    workerToken: str("WORKER_TOKEN"),
    openRouterApiKey: str("OPENROUTER_API_KEY"),
    openRouterModel: str("OPENROUTER_MODEL", "google/gemma-4-26b-a4b-it:free")!,
    openRouterTimeoutMs: num("OPENROUTER_TIMEOUT_MS", 20_000),
    defaultRadiusKm: num("AREA_DEFAULT_RADIUS_KM", 15),
    maxRadiusKm: num("AREA_MAX_RADIUS_KM", 50),
    weatherCacheTtlMs: num("WEATHER_CACHE_TTL_SECONDS", 600) * 1000,
    weatherStaleAfterMs: num("WEATHER_STALE_AFTER_MINUTES", 180) * 60_000,
    corsOrigins: (str("CORS_ORIGINS", "http://localhost:8081") ?? "").split(",").map((s) => s.trim()).filter(Boolean),
    rateLimitPerMinute: num("RATE_LIMIT_PER_MINUTE", 120),
    aiRateLimitPerMinute: num("AI_RATE_LIMIT_PER_MINUTE", 10),
    aiStreamIdleTimeoutMs: num("OPENROUTER_STREAM_IDLE_TIMEOUT_MS", 60_000),
    // Free models usually start answering in ~8 s; a tier silent for 12 s is queued, so fail over sooner.
    aiFirstTokenTimeoutMs: num("OPENROUTER_FIRST_TOKEN_TIMEOUT_MS", 12_000),
    supabaseUrl: str("SUPABASE_URL"),
    supabaseServiceKey: str("SUPABASE_SERVICE_ROLE_KEY"),
    signupRateLimitPerHour: num("SIGNUP_RATE_LIMIT_PER_HOUR", 20),
  };
}
