// Real concurrency: a real Postgres 17 server (embedded-postgres, no Docker)
// with many simultaneous connections, so the workspace row lock is actually
// exercised. PGlite can't do this (single connection).
import EmbeddedPostgres from "embedded-postgres";
import { mkdtempSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const root = path.resolve(__dirname, "..");
const USER = "00000000-0000-0000-0000-0000000000cc";

let server: EmbeddedPostgres;
let pool: pg.Pool;
let dir: string;
let ws: string;

async function q<T extends pg.QueryResultRow = Record<string, unknown>>(sql: string, params: unknown[] = []) {
  return (await pool.query<T>(sql, params)).rows;
}

async function balance() {
  return (await q<{ available: number; reserved: number; spent: number }>(
    "select available, reserved, spent from public.workspace_balance where workspace_id = $1",
    [ws],
  ))[0];
}

async function newCampaignWithLeads(name: string, count: number) {
  const [c] = await q<{ id: string }>("insert into public.campaigns (workspace_id, name) values ($1, $2) returning id", [ws, name]);
  const leads = await q<{ id: string }>(
    `insert into public.leads (campaign_id, workspace_id, email)
     select $1, $2, $3 || g || '@x.nl' from generate_series(1, $4) g returning id`,
    [c.id, ws, name, count],
  );
  return leads.map((l) => l.id);
}

/** Each call holds its transaction open a moment, so calls really overlap. */
async function inTx<T>(fn: (c: pg.PoolClient) => Promise<T>): Promise<T> {
  const c = await pool.connect();
  try {
    await c.query("begin");
    const out = await fn(c);
    await c.query("select pg_sleep(0.02)");
    await c.query("commit");
    return out;
  } catch (e) {
    await c.query("rollback");
    throw e;
  } finally {
    c.release();
  }
}

beforeAll(async () => {
  dir = mkdtempSync(path.join(tmpdir(), "firstline-pg-"));
  const port = 55_000 + Math.floor(Math.random() * 5_000);
  server = new EmbeddedPostgres({ databaseDir: dir, user: "postgres", password: "test", port, persistent: false, onLog: () => {} });
  await server.initialise();
  await server.start();
  pool = new pg.Pool({ host: "127.0.0.1", port, user: "postgres", password: "test", database: "postgres", max: 25 });

  await pool.query(readFileSync(path.join(root, "tests/supabase-shim.sql"), "utf8"));
  const migrations = path.join(root, "migrations");
  for (const f of readdirSync(migrations).filter((f) => f.endsWith(".sql")).sort()) {
    await pool.query(readFileSync(path.join(migrations, f), "utf8"));
  }
  await q("insert into auth.users (id, email) values ($1, 'c@c.nl')", [USER]);
  [{ id: ws }] = await q<{ id: string }>("select id from public.workspaces where owner_id = $1", [USER]);
}, 120_000);

afterAll(async () => {
  await pool?.end();
  await server?.stop();
  rmSync(dir, { recursive: true, force: true });
});

describe("concurrent credit operations (real Postgres)", () => {
  it("two campaigns reserving at the same time never overspend", async () => {
    await q("select public.add_purchase($1, 10, 'evt_conc')", [ws]);
    const a = await newCampaignWithLeads("a", 10);
    const b = await newCampaignWithLeads("b", 10);
    // Interleave both campaigns' leads and fire all 20 at once.
    const all = a.flatMap((id, i) => [id, b[i]]);

    const results = await Promise.all(
      all.map((lead) => inTx(async (c) => (await c.query<{ ok: boolean }>("select public.reserve_credits($1, 1) as ok", [lead])).rows[0].ok)),
    );

    expect(results.filter(Boolean)).toHaveLength(10);
    expect(await balance()).toEqual({ available: 0, reserved: 10, spent: 0 });
  });

  it("the same lead reserved by many workers at once gets one reserve", async () => {
    await q("select public.add_purchase($1, 5, 'evt_conc2')", [ws]);
    const [lead] = await newCampaignWithLeads("same", 1);
    const results = await Promise.all(
      Array.from({ length: 10 }, () =>
        inTx(async (c) => (await c.query<{ ok: boolean }>("select public.reserve_credits($1, 2) as ok", [lead])).rows[0].ok),
      ),
    );
    expect(results.every(Boolean)).toBe(true);
    expect(await q("select amount from public.credit_ledger where lead_id = $1", [lead])).toEqual([{ amount: -2 }]);
  });

  it("parallel captures and releases on one lead never exceed its reserve", async () => {
    await q("select public.add_purchase($1, 5, 'evt_conc3')", [ws]);
    const [lead] = await newCampaignWithLeads("settle", 1);
    await q("select public.reserve_credits($1, 3)", [lead]);

    await Promise.all(
      Array.from({ length: 12 }, (_, i) =>
        inTx((c) => c.query(i % 3 === 0 ? "select public.release_credits($1)" : "select public.capture_credits($1, 1)", [lead])),
      ),
    );

    const [{ settled }] = await q<{ settled: number }>(
      "select coalesce(sum(amount), 0)::int as settled from public.credit_ledger where lead_id = $1 and type in ('capture', 'release')",
      [lead],
    );
    expect(settled).toBe(3);
  });
});
