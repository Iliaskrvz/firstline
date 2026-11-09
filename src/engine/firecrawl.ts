// Thin Firecrawl v2 client (map + scrape to markdown) with timeouts and retries.
import { HttpError, parseRetryAfter, TimeoutError, withRetry } from "./retry";

export type MapLink = { url: string; title?: string; description?: string };
export type ScrapeResult = { markdown: string; statusCode: number | null; title?: string; credits: number };

export interface WebReader {
  map(url: string): Promise<{ links: MapLink[]; credits: number }>;
  scrape(url: string, timeoutMs: number): Promise<ScrapeResult>;
  /** robots.txt text, or null when the site has none (404). */
  robots(domain: string): Promise<string | null>;
  /** How many requests the Firecrawl plan runs at once (null if unknown). */
  planConcurrency?(): Promise<number | null>;
}

const BASE = "https://api.firecrawl.dev/v2";
const EXCLUDE_TAGS = ["nav", "footer", "header", "script", "style", "noscript", "iframe", "svg", "form", "aside", "[hidden]", "[aria-hidden=true]", ".cookie", "#cookie", ".cookies", ".cookie-banner", "#CybotCookiebotDialog"];

/**
 * fetch + read the body under one deadline. The timer must cover the body too:
 * a server that sends headers and then stalls would otherwise hang the job forever.
 */
async function timed<T>(
  url: string,
  init: RequestInit,
  timeoutMs: number,
  fetchImpl: typeof fetch,
  read: (res: Response) => Promise<T>,
): Promise<T> {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetchImpl(url, { ...init, signal: ctrl.signal });
    return await read(res);
  } catch (e) {
    if (ctrl.signal.aborted) throw new TimeoutError(`Timed out after ${timeoutMs} ms: ${url}`);
    throw e;
  } finally {
    clearTimeout(t);
  }
}

export type FirecrawlTimeouts = { mapMs: number; scrapeExtraMs: number; robotsMs: number };
const DEFAULT_TIMEOUTS: FirecrawlTimeouts = { mapMs: 30_000, scrapeExtraMs: 10_000, robotsMs: 8_000 };

export function createFirecrawl(apiKey: string, fetchImpl: typeof fetch = fetch, timeouts: Partial<FirecrawlTimeouts> = {}): WebReader {
  const to = { ...DEFAULT_TIMEOUTS, ...timeouts };
  const post = (path: string, body: object, timeoutMs: number) =>
    timed(
      `${BASE}${path}`,
      { method: "POST", headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" }, body: JSON.stringify(body) },
      timeoutMs,
      fetchImpl,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      async (res): Promise<any> => {
        if (!res.ok) {
          const text = await res.text().catch(() => "");
          throw new HttpError(`Firecrawl ${path} ${res.status}: ${text.slice(0, 200)}`, res.status, parseRetryAfter(res.headers.get("retry-after")));
        }
        return res.json();
      },
    );

  return {
    async map(url) {
      const j = await withRetry(() => post("/map", { url, limit: 300, sitemap: "include", includeSubdomains: false, ignoreQueryParameters: true }, to.mapMs), { retries: 2 });
      const raw: unknown[] = j.links ?? j.data?.links ?? [];
      const links = raw.map((l) => (typeof l === "string" ? { url: l } : (l as MapLink))).filter((l) => !!l?.url);
      return { links, credits: 1 };
    },
    async scrape(url, timeoutMs) {
      // A slow page gets one more try, not three: 15s each is already generous.
      const j = await withRetry(
        () =>
          post(
            "/scrape",
            { url, formats: ["markdown"], onlyMainContent: true, excludeTags: EXCLUDE_TAGS, timeout: timeoutMs, blockAds: true, removeBase64Images: true },
            timeoutMs + to.scrapeExtraMs,
          ),
        { retries: 1 },
      );
      const d = j.data ?? {};
      return {
        markdown: d.markdown ?? "",
        statusCode: d.metadata?.statusCode ?? null,
        title: d.metadata?.title,
        credits: Number(d.metadata?.creditsUsed ?? 1),
      };
    },
    async planConcurrency() {
      try {
        const j = await timed(`${BASE}/team/queue-status`, { headers: { Authorization: `Bearer ${apiKey}` } }, 5_000, fetchImpl, (res) =>
          res.ok ? res.json() : Promise.resolve(null),
        );
        const n = Number(j?.maxConcurrency);
        return Number.isInteger(n) && n > 0 ? n : null;
      } catch {
        return null;
      }
    },
    async robots(domain) {
      try {
        return await timed(
          `https://${domain}/robots.txt`,
          { headers: { "User-Agent": "FirstLineBot/1.0 (+robots check)" }, redirect: "follow" },
          to.robotsMs,
          fetchImpl,
          async (res) => {
            if (res.status >= 500) return "User-agent: *\nDisallow: /"; // server trouble: treat as "don't crawl" for now
            if (!res.ok) return null;
            const text = await res.text();
            return /<html/i.test(text) ? null : text; // some sites serve an HTML page instead
          },
        );
      } catch {
        return null; // unreachable robots.txt: the scrape itself will tell us if the site is down
      }
    },
  };
}
