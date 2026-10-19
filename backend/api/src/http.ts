import type { z } from "zod";

export class HttpError extends Error {
  constructor(
    message: string,
    readonly status: number | null,
    readonly source: string,
  ) {
    super(message);
  }
}

export type FetchJsonOptions = {
  source: string;
  timeoutMs?: number;
  retries?: number;
  signal?: AbortSignal;
  init?: RequestInit;
  /** Upper bound on honoured Retry-After; longer waits fail fast instead. */
  maxRetryAfterMs?: number;
};

const RETRYABLE = new Set([429, 502, 503, 504]);

export function backoffMs(attempt: number, baseMs = 500, capMs = 8000): number {
  // Full jitter exponential backoff.
  return Math.random() * Math.min(capMs, baseMs * 2 ** attempt);
}

function retryAfterMs(res: Response): number | null {
  const header = res.headers.get("retry-after");
  if (!header) return null;
  const seconds = Number(header);
  if (Number.isFinite(seconds)) return Math.max(0, seconds * 1000);
  const date = Date.parse(header);
  return Number.isFinite(date) ? Math.max(0, date - Date.now()) : null;
}

function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    const t = setTimeout(resolve, ms);
    signal?.addEventListener("abort", () => {
      clearTimeout(t);
      reject(signal.reason ?? new Error("aborted"));
    });
  });
}

/** fetch + timeout + retry (429/5xx, honouring Retry-After) + runtime schema validation. */
export async function fetchJson<T extends z.ZodType>(
  url: string,
  schema: T,
  opts: FetchJsonOptions,
): Promise<z.infer<T>> {
  const retries = opts.retries ?? 2;
  const maxRetryAfter = opts.maxRetryAfterMs ?? 10_000;
  let lastError: unknown;
  for (let attempt = 0; attempt <= retries; attempt++) {
    const timeout = AbortSignal.timeout(opts.timeoutMs ?? 10_000);
    const signal = opts.signal ? AbortSignal.any([opts.signal, timeout]) : timeout;
    let res: Response;
    try {
      res = await fetch(url, { ...opts.init, signal });
    } catch (err) {
      if (opts.signal?.aborted) throw err;
      lastError = err;
      if (attempt < retries) await sleep(backoffMs(attempt), opts.signal);
      continue;
    }
    if (RETRYABLE.has(res.status) && attempt < retries) {
      const wait = retryAfterMs(res);
      if (wait !== null && wait > maxRetryAfter) {
        throw new HttpError(`${opts.source} rate limited (retry after ${Math.round(wait / 1000)}s)`, res.status, opts.source);
      }
      await sleep(wait ?? backoffMs(attempt), opts.signal);
      continue;
    }
    if (!res.ok) throw new HttpError(`${opts.source} responded ${res.status}`, res.status, opts.source);
    const body: unknown = await res.json();
    const parsed = schema.safeParse(body);
    if (!parsed.success) {
      throw new HttpError(`${opts.source} returned an unexpected response shape`, res.status, opts.source);
    }
    return parsed.data;
  }
  throw new HttpError(
    `${opts.source} unreachable: ${lastError instanceof Error ? lastError.message : String(lastError)}`,
    null,
    opts.source,
  );
}
