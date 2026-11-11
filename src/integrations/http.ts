// Shared HTTP for sending-tool adapters: timeouts, per-key rate limiting, error mapping.
// Error messages never contain the request URL (Smartlead puts the API key in the query string).
import { ToolError, type FetchLike } from "./types";

/** In-process sliding-window limiter: at most `max` calls per `windowMs` per key. */
export class RateLimiter {
  private readonly calls = new Map<string, number[]>();
  constructor(
    readonly max: number,
    readonly windowMs: number,
    private readonly now: () => number = Date.now,
    private readonly sleep: (ms: number) => Promise<void> = (ms) => new Promise((r) => setTimeout(r, ms)),
  ) {}

  async take(key: string): Promise<void> {
    for (;;) {
      const t = this.now();
      const recent = (this.calls.get(key) ?? []).filter((x) => t - x < this.windowMs);
      if (recent.length < this.max) {
        recent.push(t);
        this.calls.set(key, recent);
        return;
      }
      await this.sleep(this.windowMs - (t - recent[0]) + 5);
    }
  }
}

/** "https://x/y?api_key=SECRET&a=1" → "https://x/y?api_key=***&a=1". For any log line that must show a URL. */
export function redactUrl(url: string): string {
  return url.replace(/([?&](?:api_key|apikey|key|token|access_token)=)[^&#]*/gi, "$1***");
}

export type HttpError = { status: number; message: string; retryAfterMs?: number; body: unknown };

export type CallOptions = {
  fetch: FetchLike;
  tool: string; // "Smartlead", shown in messages
  timeoutMs?: number;
  limiter?: RateLimiter;
  limiterKey?: string;
  /** Map an HTTP error to a ToolError; return null for the default mapping. */
  classify?: (e: HttpError) => ToolError | null;
};

const parse = (text: string): unknown => {
  try {
    return text ? JSON.parse(text) : null;
  } catch {
    return text;
  }
};

export function messageOf(body: unknown): string {
  if (typeof body === "string") return body.slice(0, 200);
  if (body && typeof body === "object") {
    const b = body as Record<string, unknown>;
    const m = b.message ?? b.error ?? (b.error as Record<string, unknown> | undefined)?.message;
    if (typeof m === "string") return m.slice(0, 200);
    if (m && typeof m === "object" && typeof (m as Record<string, unknown>).message === "string") return String((m as Record<string, unknown>).message).slice(0, 200);
  }
  return "";
}

export async function callJson<T>(
  o: CallOptions,
  method: string,
  url: string,
  init: { headers?: Record<string, string>; body?: unknown } = {},
): Promise<T> {
  if (o.limiter) await o.limiter.take(o.limiterKey ?? "default");
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), o.timeoutMs ?? 30_000);
  let status: number;
  let retryHeader: string | null;
  let text: string;
  try {
    const res = await o.fetch(url, {
      method,
      headers: { Accept: "application/json", ...(init.body !== undefined ? { "Content-Type": "application/json" } : {}), ...init.headers },
      body: init.body !== undefined ? JSON.stringify(init.body) : undefined,
      signal: ctrl.signal,
    });
    status = res.status;
    retryHeader = res.headers.get("retry-after");
    text = await res.text();
  } catch (e) {
    // Never pass the underlying error message on: it can contain the URL.
    throw new ToolError("transient", (e as Error).name === "AbortError" ? `${o.tool} did not answer in time.` : `Could not reach ${o.tool}.`);
  } finally {
    clearTimeout(timer);
  }
  const body = parse(text);
  if (status >= 200 && status < 300) return body as T;

  const ra = Number(retryHeader);
  const bodyRetry = (body as { error?: { retry_after?: unknown } } | null)?.error?.retry_after;
  const retryAfterMs = Number.isFinite(ra) && ra > 0 ? ra * 1000 : typeof bodyRetry === "number" ? bodyRetry * 1000 : undefined;
  const err: HttpError = { status, message: messageOf(body), retryAfterMs, body };
  const custom = o.classify?.(err);
  if (custom) throw custom;
  if (status === 401) throw new ToolError("auth", `${o.tool} rejected the API key.`);
  if (status === 402) throw new ToolError("plan", `Your ${o.tool} plan doesn't include API access.`);
  if (status === 403) throw new ToolError("scope", err.message ? `${o.tool}: ${err.message}` : `The ${o.tool} API key is missing a permission for this.`);
  if (status === 404) throw new ToolError("not_found", err.message || `Not found in ${o.tool}.`);
  if (status === 429) throw new ToolError("rate_limit", `${o.tool} rate limit reached.`, retryAfterMs ?? 5000);
  if (status >= 500) throw new ToolError("transient", `${o.tool} had an error (${status}).`);
  throw new ToolError("invalid", err.message || `${o.tool} refused the request (${status}).`);
}
