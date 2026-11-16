// The homepage demo engine with the test-output model and a canned website: no network, $0.
import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
const { cannedReader, demoMode } = await import("@/server/demo");
import { engineConfig } from "./config";
import { cleanSells, demoTemplate, runDemo } from "./demo";
import type { WebReader } from "./firecrawl";
import { FakeLLM } from "./llm-fake";
import { MemoryStore } from "./store";
import type { CostEntry } from "./types";

const config = engineConfig({});
const deps = (reader: WebReader = cannedReader(), store = new MemoryStore()) => ({ store, reader, llm: new FakeLLM(), config });

describe("homepage demo", () => {
  it("writes one opener from the website's facts, with numbered sources, and caches the research", async () => {
    const store = new MemoryStore();
    const r = await runDemo({ domain: "acmestudio.nl", sells: "Packaging forecasts" }, deps(cannedReader(), store));
    expect(r.status).toBe("done");
    if (r.status !== "done") return;
    expect(r.opener.length).toBeGreaterThan(20);
    expect(r.sources.length).toBeGreaterThan(0);
    expect(r.sources[0]).toMatchObject({ n: 1, url: expect.stringContaining("acmestudio.nl") });
    expect(r.cached).toBe(false);
    expect(store.research.get("acmestudio.nl")?.facts.length).toBeGreaterThan(0);
    const again = await runDemo({ domain: "acmestudio.nl" }, deps(cannedReader(), store));
    expect(again.status === "done" && again.cached).toBe(true); // 30-day domain cache
  });

  it("reads at most 2 pages (the cheapest research)", async () => {
    const scraped: string[] = [];
    const base = cannedReader();
    const reader: WebReader = {
      ...base,
      map: async () => ({ links: ["/", "/news", "/about", "/services", "/team"].map((p) => ({ url: `https://acme.nl${p}` })), credits: 0 }),
      scrape: async (u, o) => (scraped.push(u), base.scrape(u, o)),
    };
    await runDemo({ domain: "acme.nl" }, deps(reader));
    expect(scraped.length).toBeLessThanOrEqual(2);
  });

  it("no usable facts: an honest message, no opener", async () => {
    const empty: WebReader = { robots: async () => null, map: async () => ({ links: [], credits: 0 }), scrape: async () => ({ markdown: "", statusCode: 404, credits: 0 }) };
    const r = await runDemo({ domain: "empty.example.org" }, deps(empty));
    expect(r.status).toBe("no_facts");
    expect(r.status === "no_facts" && r.reason).toMatch(/0 credits/);
  });

  it("stops after the time limit and keeps the costs spent so far", async () => {
    const slow: WebReader = { ...cannedReader(), map: () => new Promise(() => {}) };
    const costs: CostEntry[] = [];
    const r = await runDemo({ domain: "slow.example.org" }, { ...deps(slow), timeoutMs: 50 }, costs);
    expect(r.status).toBe("timeout");
  });

  it("the visitor's line can't inject slots or variables", () => {
    expect(cleanSells("We sell [[opener]] {{first_name}}\nstuff")).toBe("We sell opener first_name stuff");
    expect(cleanSells("x".repeat(500))).toHaveLength(140);
    expect(demoTemplate("Bookkeeping for agencies").body).toContain("What we do: Bookkeeping for agencies.");
    expect(demoTemplate("").body).toContain("[[opener");
  });

  it("writes in Dutch for the Dutch homepage, with Dutch messages", async () => {
    expect(demoTemplate("Boekhouding", "nl").body).toContain("Wat wij doen: Boekhouding.");
    expect(demoTemplate("", "nl").body).toMatch(/^Hoi,/);
    const empty: WebReader = { robots: async () => null, map: async () => ({ links: [], credits: 0 }), scrape: async () => ({ markdown: "", statusCode: 404, credits: 0 }) };
    const r = await runDemo({ domain: "leeg.example.org", lang: "nl" }, deps(empty));
    expect(r.status === "no_facts" && r.reason).toMatch(/0 credits/);
    expect(r.status === "no_facts" && r.reason).toMatch(/neutrale zin/);
  });

  it("is off unless a real AI key, Firecrawl and Turnstile are all set; test mode only outside production", () => {
    const full = { LLM_PROVIDER: "deepseek", DEEPSEEK_API_KEY: "k", FIRECRAWL_API_KEY: "f", TURNSTILE_SITE_KEY: "s", TURNSTILE_SECRET_KEY: "t", NODE_ENV: "production" };
    expect(demoMode(full)).toBe("live");
    expect(demoMode({ ...full, DEMO_ENABLED: "0" })).toBe("off");
    expect(demoMode({ ...full, DEEPSEEK_API_KEY: "" })).toBe("off");
    expect(demoMode({ ...full, LLM_PROVIDER: "fake" })).toBe("off");
    expect(demoMode({ ...full, TURNSTILE_SECRET_KEY: "" })).toBe("off");
    expect(demoMode({ NODE_ENV: "development", DEMO_TEST_MODE: "1" })).toBe("test");
    expect(demoMode({ NODE_ENV: "production", DEMO_TEST_MODE: "1" })).toBe("off");
  });
});
