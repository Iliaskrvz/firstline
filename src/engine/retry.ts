// Retry with exponential backoff + jitter for 429 / 5xx / network errors.

export class HttpError extends Error {
  constructor(
    message: string,
    public status: number,
    public retryAfterMs: number | null = null,
  ) {
    super(message);
    this.name = "HttpError";
  }
}

export class TimeoutError extends Error {
  constructor(message = "Request timed out") {
    super(message);
    this.name = "TimeoutError";
  }
}

export function isRetryable(e: unknown): boolean {
  if (e instanceof HttpError) return e.status === 429 || e.status === 408 || e.status >= 500;
  if (e instanceof TimeoutError) return true;
  if (e instanceof TypeError) return true; // fetch network failure
  return false;
}

export function backoffMs(attempt: number, baseMs: number, maxMs: number, random = Math.random): number {
  const exp = Math.min(maxMs, baseMs * 2 ** attempt);
  return Math.round(exp / 2 + (exp / 2) * random());
}

export async function withRetry<T>(
  fn: (attempt: number) => Promise<T>,
  opts: { retries?: number; baseMs?: number; maxMs?: number; sleep?: (ms: number) => Promise<void> } = {},
): Promise<T> {
  const { retries = 3, baseMs = 500, maxMs = 8_000, sleep = (ms) => new Promise((r) => setTimeout(r, ms)) } = opts;
  for (let attempt = 0; ; attempt++) {
    try {
      return await fn(attempt);
    } catch (e) {
      if (attempt >= retries || !isRetryable(e)) throw e;
      const hinted = e instanceof HttpError && e.retryAfterMs != null ? Math.min(e.retryAfterMs, 60_000) : null;
      await sleep(hinted ?? backoffMs(attempt, baseMs, maxMs));
    }
  }
}

export function parseRetryAfter(v: string | null): number | null {
  if (!v) return null;
  const secs = Number(v);
  if (Number.isFinite(secs)) return secs * 1000;
  const at = Date.parse(v);
  return Number.isFinite(at) ? Math.max(0, at - Date.now()) : null;
}
