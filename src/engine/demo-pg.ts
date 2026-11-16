// Public demo, the database side: limits (per IP per day, and a global daily cap), the 30-day result
// cache per domain, cost logging to usage_costs tagged with demo_run_id, and the /admin numbers.
import { createHash } from "node:crypto";
import type pg from "pg";
import type { DemoLang, DemoResult } from "./demo";
import type { CostEntry } from "./types";

export const DEMO_PER_IP_PER_DAY = 3;
export const DEMO_CACHE_DAYS = 30;
export const DEMO_RETENTION_DAYS = 30;

/** The global daily cap: DEMO_DAILY_CAP, default 300. */
export const demoDailyCap = (env: Record<string, string | undefined> = process.env) => {
  const n = Number(env.DEMO_DAILY_CAP);
  return Number.isFinite(n) && n >= 0 ? Math.floor(n) : 300;
};

/** The visitor's IP, hashed with a server secret: enough to count requests, not to identify anyone. */
export function hashIp(ip: string, salt: string): string {
  return createHash("sha256").update(`demo:${salt}:${ip}`).digest("hex").slice(0, 32);
}

const dayStart = (now: Date) => new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));

export type DemoAdmission = { ok: true; id: number } | { ok: false; reason: "ip_limit" | "daily_cap" };

/**
 * Admit one demo request, or say why not. Counted and inserted under one lock, so parallel requests
 * can't go over either limit.
 */
export async function admitDemo(pool: pg.Pool, input: { ipHash: string; domain: string; sells: string; lang?: DemoLang; now?: Date; cap?: number; perIp?: number }): Promise<DemoAdmission> {
  const now = input.now ?? new Date();
  const c = await pool.connect();
  try {
    await c.query("begin");
    await c.query("select pg_advisory_xact_lock(hashtext('public-demo'))");
    const { rows } = await c.query<{ ip: number; total: number }>(
      "select count(*) filter (where ip_hash = $2)::int ip, count(*)::int total from public.demo_runs where created_at >= $1",
      [dayStart(now), input.ipHash],
    );
    if (rows[0].ip >= (input.perIp ?? DEMO_PER_IP_PER_DAY)) {
      await c.query("rollback");
      return { ok: false, reason: "ip_limit" };
    }
    if (rows[0].total >= (input.cap ?? demoDailyCap())) {
      await c.query("rollback");
      return { ok: false, reason: "daily_cap" };
    }
    const ins = await c.query<{ id: number }>("insert into public.demo_runs (ip_hash, domain, sells, lang, created_at) values ($1, $2, $3, $4, $5) returning id", [
      input.ipHash,
      input.domain,
      input.sells,
      input.lang ?? "en",
      now,
    ]);
    await c.query("commit");
    return { ok: true, id: Number(ins.rows[0].id) };
  } catch (e) {
    await c.query("rollback").catch(() => {});
    throw e;
  } finally {
    c.release();
  }
}

/** A finished example for the same domain, "what you sell" line and language in the last 30 days: shown again, for free. */
export async function cachedDemo(pool: pg.Pool, domain: string, sells: string, now = new Date(), lang: DemoLang = "en"): Promise<DemoResult | null> {
  const { rows } = await pool.query<{ result: DemoResult }>(
    `select result from public.demo_runs where domain = $1 and sells = $2 and lang = $5 and status in ('done', 'no_facts') and result is not null
       and created_at > $3::timestamptz - make_interval(days => $4) order by created_at desc limit 1`,
    [domain, sells, now, DEMO_CACHE_DAYS, lang],
  );
  return rows[0]?.result ?? null;
}

/** Store the result and log every paid call to usage_costs (no workspace, tagged demo_run_id). */
export async function finishDemo(pool: pg.Pool, id: number, result: DemoResult, costs: CostEntry[], opts: { cached?: boolean } = {}) {
  for (const c of costs) {
    await pool.query(
      `insert into public.usage_costs (workspace_id, step, model, input_tokens, output_tokens, cached_tokens, provider_units, cost_usd, demo_run_id)
       values (null, $1, $2, $3, $4, $5, $6, $7, $8)`,
      [c.step, c.model, c.input_tokens ?? 0, c.output_tokens ?? 0, c.cached_tokens ?? 0, c.provider_units ?? 0, c.cost_usd, id],
    );
  }
  const usd = costs.reduce((s, c) => s + Number(c.cost_usd), 0);
  await pool.query("update public.demo_runs set status = $2, result = $3, cost_usd = $4, finished_at = now() where id = $1", [
    id,
    opts.cached ? "cached" : result.status,
    JSON.stringify(result),
    usd,
  ]);
}

export type DemoStats = { day: string; runs: number; cached: number; costUsd: number; cap: number };

/** Today's demo numbers for /admin, plus the last 7 days. */
export async function demoStats(pool: pg.Pool, now = new Date(), cap = demoDailyCap()): Promise<DemoStats[]> {
  const { rows } = await pool.query<{ day: string; runs: number; cached: number; cost_usd: number }>(
    `select to_char(d.day, 'YYYY-MM-DD') as day,
            (select count(*) from public.demo_runs r where r.created_at::date = d.day)::int runs,
            (select count(*) from public.demo_runs r where r.created_at::date = d.day and r.status = 'cached')::int cached,
            coalesce((select sum(cost_usd) from public.usage_costs u where u.demo_run_id is not null and u.created_at::date = d.day), 0)::float cost_usd
       from (select generate_series($1::date - 6, $1::date, interval '1 day')::date as day) d order by d.day desc`,
    [now],
  );
  return rows.map((r) => ({ day: r.day, runs: r.runs, cached: r.cached, costUsd: r.cost_usd, cap }));
}

/** Retention: demo rows (domain + IP hash) go after 30 days; their costs stay, untagged. */
export async function purgeDemoRuns(pool: pg.Pool, now = new Date()): Promise<number> {
  const r = await pool.query("delete from public.demo_runs where created_at < $1::timestamptz - make_interval(days => $2)", [now, DEMO_RETENTION_DAYS]);
  return r.rowCount ?? 0;
}
