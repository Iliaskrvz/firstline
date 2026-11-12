// Integration: limits shared by several workers, on a real Postgres 17 (embedded). Two separate pools
// stand in for two worker processes.
import EmbeddedPostgres from "embedded-postgres";
import { mkdtempSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { jobContext, PRIORITY } from "@/engine/job-context";
import { acquireWorkspaceSlot, asSingleton, deferDelaySeconds, PgRateGate, PgSlotGate, PREVIEW_EXTRA, releaseWorkspaceSlot, workspaceLimit } from "@/engine/limiter-pg";
import { concurrencyLevel } from "@/lib/concurrency";
import { anthropicBudget, firecrawlBudget, newAlertLevel } from "@/billing/budgets";

const root = path.resolve(__dirname, "..");
const USER = "00000000-0000-0000-0000-00000000bb01";
let server: EmbeddedPostgres;
let a: pg.Pool;
let b: pg.Pool;
let dir: string;
let ws: string;

beforeAll(async () => {
  dir = mkdtempSync(path.join(tmpdir(), "firstline-limits-"));
  const port = 42_000 + Math.floor(Math.random() * 1_000);
  server = new EmbeddedPostgres({ databaseDir: dir, user: "postgres", password: "test", port, persistent: false, onLog: () => {} });
  await server.initialise();
  await server.start();
  const cfg = { host: "127.0.0.1", port, user: "postgres", password: "test", database: "postgres", max: 12 };
  a = new pg.Pool(cfg);
  b = new pg.Pool(cfg);
  await a.query(readFileSync(path.join(root, "tests/supabase-shim.sql"), "utf8"));
  for (const f of readdirSync(path.join(root, "migrations")).filter((f) => f.endsWith(".sql")).sort()) {
    await a.query(readFileSync(path.join(root, "migrations", f), "utf8"));
  }
  await a.query("insert into auth.users (id, email) values ($1, 'x@limits.nl')", [USER]);
  ws = (await a.query("select id from public.workspaces where owner_id = $1", [USER])).rows[0].id;
}, 120_000);

afterAll(async () => {
  await a?.end();
  await b?.end();
  await server?.stop();
  rmSync(dir, { recursive: true, force: true });
});

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

describe("limits shared across workers", () => {
  it("PgSlotGate: never more calls at once than the plan allows, across two workers", async () => {
    const g1 = new PgSlotGate(a, "firecrawl-test", 3, { pollMs: 10 });
    const g2 = new PgSlotGate(b, "firecrawl-test", 3, { pollMs: 10 });
    let now = 0;
    let max = 0;
    const call = async () => {
      now++;
      max = Math.max(max, now);
      await wait(30);
      now--;
    };
    await Promise.all(Array.from({ length: 20 }, (_, i) => (i % 2 ? g1 : g2).run(call)));
    expect(max).toBe(3);
    expect(g1.stats.calls + g2.stats.calls).toBe(20);
    expect(g1.stats.waitedMs + g2.stats.waitedMs).toBeGreaterThan(0);
    const { rows } = await a.query("select count(*)::int n from public.provider_slots where provider = 'firecrawl-test' and holder is not null");
    expect(rows[0].n).toBe(0); // all released
  });

  it("PgSlotGate: a slot held by a crashed worker frees itself when its lease runs out", async () => {
    await a.query("insert into public.provider_slots (provider, slot, holder, expires_at) values ('crash-test', 0, 'dead-worker', now() + interval '200 milliseconds')");
    const g = new PgSlotGate(a, "crash-test", 1, { pollMs: 20 });
    const t0 = Date.now();
    await g.run(async () => undefined);
    expect(Date.now() - t0).toBeGreaterThanOrEqual(150);
  });

  it("PgRateGate: at most N calls per minute, across workers", async () => {
    let t = Date.parse("2026-11-12T10:00:30Z");
    const sleeps: number[] = [];
    const opts = { now: () => t, sleep: async (ms: number) => void (sleeps.push(ms), (t += ms)) };
    const g1 = new PgRateGate(a, "anthropic-test", 5, opts);
    const g2 = new PgRateGate(b, "anthropic-test", 5, opts);
    for (let i = 0; i < 5; i++) await (i % 2 ? g1 : g2).run(async () => undefined);
    expect(sleeps).toEqual([]);
    await g1.run(async () => undefined); // 6th call waits for the next minute
    expect(sleeps.length).toBeGreaterThan(0);
    expect(new Date(t).getUTCMinutes()).toBe(1);
  });

  it("workspace slots: at most the workspace's limit, freed on release or when a worker dies", async () => {
    const leads = Array.from({ length: 4 }, (_, i) => `00000000-0000-0000-0000-0000000c000${i}`);
    const got = await Promise.all(leads.map((leadId, i) => acquireWorkspaceSlot(i % 2 ? a : b, { workspaceId: ws, leadId, workerId: `w${i % 2}`, limit: 3 })));
    expect(got.filter((g) => g.ok)).toHaveLength(3);
    const blocked = leads[got.findIndex((g) => !g.ok)];
    await releaseWorkspaceSlot(a, leads[got.findIndex((g) => g.ok)]);
    expect(await acquireWorkspaceSlot(a, { workspaceId: ws, leadId: blocked, workerId: "w0", limit: 3 })).toEqual({ ok: true });
    // A crashed worker's slots expire.
    await a.query("update public.workspace_slots set expires_at = now() - interval '1 second' where workspace_id = $1", [ws]);
    expect(await acquireWorkspaceSlot(b, { workspaceId: ws, leadId: "00000000-0000-0000-0000-0000000c0099", workerId: "w1", limit: 1 })).toEqual({ ok: true });
    await a.query("delete from public.workspace_slots");
  });

  it("the limit follows credits bought, unless the workspace has its own setting", async () => {
    expect(await workspaceLimit(a, ws, concurrencyLevel)).toBe(5);
    await a.query("select public.add_purchase($1, 10000, 'limits:1', 'Agency pack')", [ws]);
    expect(await workspaceLimit(a, ws, concurrencyLevel)).toBe(20);
    await a.query("update public.workspaces set concurrency_limit = 8 where id = $1", [ws]);
    expect(await workspaceLimit(a, ws, concurrencyLevel)).toBe(8);
  });

  it("asSingleton: a periodic task runs on one worker at a time", async () => {
    let running = 0;
    let max = 0;
    const task = async () => {
      running++;
      max = Math.max(max, running);
      await wait(50);
      running--;
      return "done";
    };
    const r = await Promise.all([asSingleton(a, "economy-test", task), asSingleton(b, "economy-test", task)]);
    expect(r.filter((x) => x === "done")).toHaveLength(1);
    expect(r).toContain(null);
    expect(max).toBe(1);
    expect(await asSingleton(a, "economy-test", task)).toBe("done"); // the lock was released
  });

  it("fair sharing: a small workspace gets the next free slot, before a big workspace's queue", async () => {
    const g = new PgSlotGate(a, "fair-test", 2, { pollMs: 5 });
    const order: string[] = [];
    const call = (who: string, ms: number) => async () => {
      order.push(who);
      await wait(ms);
    };
    const big = Array.from({ length: 8 }, (_, i) => jobContext.run({ workspaceId: "big", priority: PRIORITY.run }, () => g.run(call(`big${i}`, 40))));
    await wait(15); // the big run already holds both slots and has 6 calls waiting
    const small = Array.from({ length: 2 }, (_, i) => jobContext.run({ workspaceId: "small", priority: PRIORITY.run }, () => g.run(call(`small${i}`, 40))));
    await Promise.all([...big, ...small]);
    // Both small calls start within the next two freed slots, not after the whole big queue.
    expect(order.indexOf("small0")).toBeLessThanOrEqual(4);
    expect(order.indexOf("small1")).toBeLessThanOrEqual(5);
  });

  it("fair sharing: a free preview goes before a big run's waiting calls, even from the same workspace", async () => {
    const g = new PgSlotGate(a, "preview-test", 1, { pollMs: 5 });
    const order: string[] = [];
    const call = (who: string) => async () => {
      order.push(who);
      await wait(30);
    };
    const run = Array.from({ length: 5 }, (_, i) => jobContext.run({ workspaceId: "ws1", priority: PRIORITY.run }, () => g.run(call(`run${i}`))));
    await wait(10);
    const preview = jobContext.run({ workspaceId: "ws1", priority: PRIORITY.preview }, () => g.run(call("preview")));
    await Promise.all([...run, preview]);
    expect(order.indexOf("preview")).toBe(1); // right after the call that was already running
  });

  it("fair share of workers: a workspace can't take more than its share while others wait; previews may go a bit over", async () => {
    await a.query("delete from public.workspace_slots; delete from public.workspace_demand");
    const big = "00000000-0000-0000-0000-00000000f001";
    const small = "00000000-0000-0000-0000-00000000f002";
    const lead = (n: number) => `00000000-0000-0000-0000-0000000d${String(n).padStart(4, "0")}`;
    const take = (wsId: string, n: number, preview = false) => acquireWorkspaceSlot(a, { workspaceId: wsId, leadId: lead(n), workerId: "w", limit: 40, capacity: 4, preview });
    // Alone, the big workspace may use all 4 worker slots.
    for (let i = 0; i < 4; i++) expect(await take(big, i)).toEqual({ ok: true });
    // Once the small one wants capacity too, the big one is held at its share (4 ÷ 2 = 2) …
    expect(await take(small, 100)).toEqual({ ok: true });
    for (let i = 0; i < 2; i++) await releaseWorkspaceSlot(a, lead(i));
    expect(await take(big, 10)).toEqual({ ok: false, reason: "fair_share" });
    expect(await take(small, 101)).toEqual({ ok: true });
    // … but a preview may go PREVIEW_EXTRA over.
    expect(await take(big, 20, true)).toEqual({ ok: true });
    expect(PREVIEW_EXTRA).toBe(5);
  });

  it("waiting reschedules with a growing delay; it is never a failed attempt", () => {
    expect([1, 2, 3, 4, 5, 6, 20].map(deferDelaySeconds)).toEqual([2, 4, 8, 16, 30, 30, 30]);
    expect(deferDelaySeconds(0)).toBe(1);
  });

  it("provider budgets: Firecrawl from its own numbers or our log, Anthropic vs the cap; one alert per level per month", async () => {
    const fromFc = await firecrawlBudget(a, { remaining: 150, plan: 1000, periodStart: null, periodEnd: "2026-11-30T23:59:59Z" });
    expect(fromFc).toMatchObject({ used: 850, limit: 1000, pct: 85, source: "Firecrawl" });
    await a.query("insert into public.usage_costs (workspace_id, step, model, provider_units, cost_usd) values ($1, 'scrape', 'firecrawl-scrape', 300, 0.25), ($1, 'write', 'claude-sonnet-5-5', 0, 42.5)", [ws]);
    expect(await firecrawlBudget(a, null, { FIRECRAWL_MONTHLY_CREDITS: "1000" })).toMatchObject({ used: 300, pct: 30, source: "our log this month" });
    const an = await anthropicBudget(a, { ANTHROPIC_MONTHLY_CAP_USD: "50" });
    expect(an).toMatchObject({ used: 42.5, limit: 50, pct: 85 });
    expect(await anthropicBudget(a, {})).toMatchObject({ limit: null, pct: null });
    expect(await newAlertLevel(a, an)).toBe(80);
    expect(await newAlertLevel(a, an)).toBeNull(); // once
    expect(await newAlertLevel(a, { ...an, pct: 101 })).toBe(100);
    expect(await newAlertLevel(a, { ...an, pct: 50 })).toBeNull();
  });
});
