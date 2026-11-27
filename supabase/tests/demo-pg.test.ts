// Homepage demo on a real Postgres 17 (embedded): per-IP and daily limits (also under parallel
// requests), the 30-day result cache, demo-tagged costs (out of customer margins), and cleanup.
import EmbeddedPostgres from "embedded-postgres";
import { mkdtempSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { loadAdmin, loadCostBreakdown } from "@/billing/admin-db";
import type { DemoResult } from "@/engine/demo";
import { admitDemo, cachedDemo, demoStats, finishDemo, hashIp, purgeDemoRuns } from "@/engine/demo-pg";
import { freePort } from "./free-port";

const root = path.resolve(__dirname, "..");
let server: EmbeddedPostgres;
let pool: pg.Pool;
let dir: string;

beforeAll(async () => {
  dir = mkdtempSync(path.join(tmpdir(), "firstline-demo-"));
  const port = await freePort();
  server = new EmbeddedPostgres({ databaseDir: dir, user: "postgres", password: "test", port, persistent: false, onLog: () => {} });
  await server.initialise();
  await server.start();
  pool = new pg.Pool({ host: "127.0.0.1", port, user: "postgres", password: "test", database: "postgres", max: 10 });
  await pool.query(readFileSync(path.join(root, "tests/supabase-shim.sql"), "utf8"));
  for (const f of readdirSync(path.join(root, "migrations")).filter((f) => f.endsWith(".sql")).sort()) {
    await pool.query(readFileSync(path.join(root, "migrations", f), "utf8"));
  }
}, 120_000);

afterAll(async () => {
  await pool?.end();
  await server?.stop();
  rmSync(dir, { recursive: true, force: true });
});

const DONE: DemoResult = { status: "done", domain: "acme.nl", opener: "Saw that Acme opened a Rotterdam studio, congrats.", sources: [{ n: 1, id: "F1", text: "Acme opened a Rotterdam studio.", url: "https://acme.nl/news" }], cached: false };

describe("homepage demo (database)", () => {
  it("3 per IP per day; the IP is only stored as a salted hash", async () => {
    const ip = hashIp("203.0.113.9", "salt");
    expect(ip).not.toContain("203.0.113.9");
    expect(hashIp("203.0.113.9", "other")).not.toBe(ip);
    for (let i = 0; i < 3; i++) expect((await admitDemo(pool, { ipHash: ip, domain: `a${i}.nl`, sells: "" })).ok).toBe(true);
    expect(await admitDemo(pool, { ipHash: ip, domain: "a4.nl", sells: "" })).toEqual({ ok: false, reason: "ip_limit" });
    expect((await admitDemo(pool, { ipHash: hashIp("198.51.100.7", "salt"), domain: "b.nl", sells: "" })).ok).toBe(true);
  });

  it("the global daily cap holds, also with many requests at the same time", async () => {
    await pool.query("delete from public.demo_runs");
    const results = await Promise.all(Array.from({ length: 12 }, (_, i) => admitDemo(pool, { ipHash: `ip${i}`, domain: "c.nl", sells: "", cap: 5 })));
    expect(results.filter((r) => r.ok)).toHaveLength(5);
    expect(results.filter((r) => !r.ok && r.reason === "daily_cap")).toHaveLength(7);
  });

  it("finished examples are reused for 30 days; costs are tagged with the demo and kept out of margins", async () => {
    await pool.query("delete from public.demo_runs");
    const a = await admitDemo(pool, { ipHash: "x", domain: "acme.nl", sells: "bookkeeping" });
    if (!a.ok) throw new Error("not admitted");
    await finishDemo(pool, a.id, DONE, [
      { step: "scrape", model: "firecrawl-scrape", provider_units: 2, cost_usd: 0.00166 },
      { step: "write", model: "deepseek-flash", input_tokens: 1500, output_tokens: 200, cached_tokens: 0, cost_usd: 0.00069 },
    ]);
    expect(await cachedDemo(pool, "acme.nl", "bookkeeping")).toMatchObject({ status: "done", opener: DONE.opener });
    expect(await cachedDemo(pool, "acme.nl", "something else")).toBeNull();
    expect(await cachedDemo(pool, "acme.nl", "bookkeeping", new Date(Date.now() + 31 * 86_400_000))).toBeNull();

    const tagged = await pool.query("select count(*)::int n, sum(cost_usd)::float usd from public.usage_costs where demo_run_id = $1 and workspace_id is null", [a.id]);
    expect(tagged.rows[0]).toEqual({ n: 2, usd: 0.00235 });
    expect((await loadCostBreakdown(pool)).filter((r) => r.source === "demo")).toHaveLength(2);
    expect((await loadAdmin(pool)).days.reduce((s, d) => s + d.costUsd, 0)).toBe(0);
    const today = (await demoStats(pool, new Date(), 300))[0];
    expect(today).toMatchObject({ runs: 1, cached: 0, cap: 300 });
    expect(today.costUsd).toBeCloseTo(0.00235, 6);
  });

  it("demo rows are deleted after 30 days; their costs stay", async () => {
    const before = (await pool.query("select count(*)::int n from public.usage_costs")).rows[0].n;
    expect(await purgeDemoRuns(pool, new Date(Date.now() + 31 * 86_400_000))).toBeGreaterThan(0);
    expect((await pool.query("select count(*)::int n from public.demo_runs")).rows[0].n).toBe(0);
    expect((await pool.query("select count(*)::int n from public.usage_costs")).rows[0].n).toBe(before);
  });
});
