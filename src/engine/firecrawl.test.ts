import { describe, expect, it } from "vitest";
import { createFirecrawl } from "./firecrawl";
import { TimeoutError } from "./retry";

/** Headers arrive at once, the body never finishes — like Node's fetch, aborting errors the body. */
function stallingBodyFetch(calls: { n: number }): typeof fetch {
  return (async (_url: string | URL | Request, init?: RequestInit) => {
    calls.n++;
    const signal = init?.signal;
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new TextEncoder().encode('{"links": ['));
        signal?.addEventListener("abort", () => controller.error(new DOMException("aborted", "AbortError")));
      },
    });
    return new Response(body, { status: 200, headers: { "content-type": "application/json" } });
  }) as typeof fetch;
}

const okFetch = (json: unknown): typeof fetch =>
  (async () => new Response(JSON.stringify(json), { status: 200, headers: { "content-type": "application/json" } })) as typeof fetch;

describe("Firecrawl client timeouts", () => {
  it("times out when the body stalls after the headers (map retries, then gives up)", async () => {
    const calls = { n: 0 };
    const fc = createFirecrawl("test", stallingBodyFetch(calls), { mapMs: 40 });
    await expect(fc.map("https://example.com")).rejects.toBeInstanceOf(TimeoutError);
    expect(calls.n).toBe(3); // first try + 2 retries
  }, 10_000);

  it("times out a stalled scrape body too", async () => {
    const calls = { n: 0 };
    const fc = createFirecrawl("test", stallingBodyFetch(calls), { scrapeExtraMs: 0 });
    await expect(fc.scrape("https://example.com", 40)).rejects.toBeInstanceOf(TimeoutError);
    expect(calls.n).toBe(2);
  }, 10_000);

  it("treats a stalled robots.txt body as 'no robots.txt' instead of hanging", async () => {
    const fc = createFirecrawl("test", stallingBodyFetch({ n: 0 }), { robotsMs: 40 });
    const started = Date.now();
    await expect(fc.robots("example.com")).resolves.toBeNull();
    expect(Date.now() - started).toBeLessThan(2_000);
  });

  it("still parses normal responses", async () => {
    const fc = createFirecrawl("test", okFetch({ links: [{ url: "https://example.com/about" }, "https://example.com/blog"] }));
    const m = await fc.map("https://example.com");
    expect(m.links.map((l) => l.url)).toEqual(["https://example.com/about", "https://example.com/blog"]);
  });
});
