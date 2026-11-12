// Integration: limits shared by several workers, on a real Postgres 17 (embedded). Two separate pools
// stand in for two worker processes.
import EmbeddedPostgres from "embedded-postgres";
import { mkdtempSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { acquireWorkspaceSlot, asSingleton, PgRateGate, PgSlotGate, releaseWorkspaceSlot, workspaceLimit } from "@/engine/limiter-pg";
import { concurrencyLevel } from "@/lib/concurrency";

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
    expect(sleeps.length).toBe(1);
    expect(new Date(t).getUTCMinutes()).toBe(1);
  });

  it("workspace slots: at most the workspace's limit, freed on release or when a worker dies", async () => {
    const leads = Array.from({ length: 4 }, (_, i) => `00000000-0000-0000-0000-0000000c000${i}`);
    const got = await Promise.all(leads.map((leadId, i) => acquireWorkspaceSlot(i % 2 ? a : b, { workspaceId: ws, leadId, workerId: `w${i % 2}`, limit: 3 })));
    expect(got.filter(Boolean)).toHaveLength(3);
    const blocked = leads[got.indexOf(false)];
    await releaseWorkspaceSlot(a, leads[got.indexOf(true)]);
    expect(await acquireWorkspaceSlot(a, { workspaceId: ws, leadId: blocked, workerId: "w0", limit: 3 })).toBe(true);
    // A crashed worker's slots expire.
    await a.query("update public.workspace_slots set expires_at = now() - interval '1 second' where workspace_id = $1", [ws]);
    expect(await acquireWorkspaceSlot(b, { workspaceId: ws, leadId: "00000000-0000-0000-0000-0000000c0099", workerId: "w1", limit: 1 })).toBe(true);
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
});
