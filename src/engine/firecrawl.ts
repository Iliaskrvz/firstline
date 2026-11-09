// Thin Firecrawl v2 client (map + scrape to markdown) with timeouts and retries.
import { HttpError, parseRetryAfter, TimeoutError, withRetry } from "./retry";

export type MapLink = { url: string; title?: string; description?: string };
export type ScrapeResult = { markdown: string; statusCode: number | null; title?: string; credits: number };

export interface WebReader {
  map(url: string): Promise<{ links: MapLink[]; credits: number }>;
  scrape(url: string, timeoutMs: number): Promise<ScrapeResult>;
  /** robots.txt text, or null when the site has none (404). */
  robots(domain: string): Promise<string | null>;
}

const BASE = "https://api.firecrawl.dev/v2";
const EXCLUDE_TAGS = ["nav", "footer", "header", "script", "style", "noscript", "iframe", "svg", "form", "aside", "[hidden]", "[aria-hidden=true]", ".cookie", "#cookie", ".cookies", ".cookie-banner", "#CybotCookiebotDialog"];

async function timed(url: string, init: RequestInit, timeoutMs: number, fetchImpl: typeof fetch): Promise<Response> {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    return await fetchImpl(url, { ...init, signal: ctrl.signal });
  } catch (e) {
    if ((e as Error).name === "AbortError") throw new TimeoutError(`Timed out after ${timeoutMs} ms: ${url}`);
    throw e;
  } finally {
    clearTimeout(t);
  }
}

export function createFirecrawl(apiKey: string, fetchImpl: typeof fetch = fetch): WebReader {
  const post = async (path: string, body: object, timeoutMs: number) => {
    const res = await timed(
      `${BASE}${path}`,
      { method: "POST", headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" }, body: JSON.stringify(body) },
      timeoutMs,
      fetchImpl,
    );
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      throw new HttpError(`Firecrawl ${path} ${res.status}: ${text.slice(0, 200)}`, res.status, parseRetryAfter(res.headers.get("retry-after")));
    }
    return res.json();
  };

  return {
    async map(url) {
      const j = await withRetry(() => post("/map", { url, limit: 300, sitemap: "include", includeSubdomains: false, ignoreQueryParameters: true }, 30_000), { retries: 2 });
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
            timeoutMs + 10_000,
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
    async robots(domain) {
      try {
        const res = await timed(`https://${domain}/robots.txt`, { headers: { "User-Agent": "FirstLineBot/1.0 (+robots check)" }, redirect: "follow" }, 8_000, fetchImpl);
        if (res.status >= 500) return "User-agent: *\nDisallow: /"; // server trouble: treat as "don't crawl" for now
        if (!res.ok) return null;
        const text = await res.text();
        return /<html/i.test(text) ? null : text; // some sites serve an HTML page instead
      } catch {
        return null; // unreachable robots.txt: the scrape itself will tell us if the site is down
      }
    },
  };
}
