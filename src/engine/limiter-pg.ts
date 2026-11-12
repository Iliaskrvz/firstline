// Limits shared by every worker process, kept in Postgres (Phase 10):
// - PgSlotGate: at most N calls at once per provider (Firecrawl's plan concurrency).
// - PgRateGate: at most N calls per minute per provider (Anthropic's requests per minute).
// - Workspace slots: at most N leads of one workspace in progress at once.
// Holders that crash just let their lease run out. No pg-boss here (engine rule).
import { randomUUID } from "node:crypto";
import type pg from "pg";
import { currentJob, type JobContext } from "./job-context";
import type { Gate } from "./limiter";

const defaultSleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));
const jitter = (ms: number) => ms / 2 + Math.random() * ms;

export type GateStats = { calls: number; waitedMs: number; maxWaitMs: number };

const WAITER_TTL_S = 15;

/**
 * Fair admission: may this waiter go now, given `free` places? Yes if fewer than `free` waiters are
 * ahead of it. Ahead = higher priority (previews), or same priority and their workspace uses fewer
 * places right now, or same on both and waiting longer. Run inside the provider's advisory lock.
 */
async function admitted(c: pg.PoolClient, provider: string, me: string, free: number, usageSql: string): Promise<boolean> {
  if (free <= 0) return false;
  const { rows } = await c.query<{ ahead: number }>(
    `with usage as (${usageSql}),
          w as (select w.*, coalesce(u.n, 0) used from public.provider_waiters w left join usage u on u.workspace_id = w.workspace_id
                 where w.provider = $1 and w.expires_at > now()),
          me as (select * from w where id = $2)
     select count(*)::int ahead from w, me
      where w.id <> me.id and (w.priority > me.priority
         or (w.priority = me.priority and w.used < me.used)
         or (w.priority = me.priority and w.used = me.used and (w.created_at, w.id) < (me.created_at, me.id)))`,
    [provider, me],
  );
  return rows[0].ahead < free;
}

async function inProviderLock<T>(pool: pg.Pool, provider: string, fn: (c: pg.PoolClient) => Promise<T>): Promise<T> {
  const c = await pool.connect();
  try {
    await c.query("begin");
    await c.query("select pg_advisory_xact_lock(hashtext('provider:' || $1))", [provider]);
    const r = await fn(c);
    await c.query("commit");
    return r;
  } catch (e) {
    await c.query("rollback").catch(() => {});
    throw e;
  } finally {
    c.release();
  }
}

async function refreshWaiter(c: pg.PoolClient, provider: string, me: string, ctx: JobContext) {
  await c.query("delete from public.provider_waiters where provider = $1 and expires_at < now()", [provider]);
  await c.query(
    `insert into public.provider_waiters (id, provider, workspace_id, priority, expires_at) values ($1, $2, $3, $4, now() + make_interval(secs => $5))
     on conflict (id) do update set expires_at = excluded.expires_at`,
    [me, provider, ctx.workspaceId, ctx.priority, WAITER_TTL_S],
  );
}

/**
 * At most N calls at once per provider, shared by every worker, shared fairly between workspaces
 * (previews first). Waiting here never fails or retries a job: the call just starts later.
 */
export class PgSlotGate implements Gate {
  readonly stats: GateStats = { calls: 0, waitedMs: 0, maxWaitMs: 0 };
  private ready: Promise<void> | null = null;

  constructor(
    private readonly pool: pg.Pool,
    readonly provider: string,
    readonly slots: number,
    private readonly opts: { leaseMs?: number; pollMs?: number; sleep?: (ms: number) => Promise<void> } = {},
  ) {}

  private ensureRows() {
    this.ready ??= this.pool
      .query("insert into public.provider_slots (provider, slot) select $1, g from generate_series(0, $2 - 1) g on conflict do nothing", [this.provider, this.slots])
      .then(() => undefined);
    return this.ready;
  }

  private tryAcquire(me: string, ctx: JobContext): Promise<number | null> {
    return inProviderLock(this.pool, this.provider, async (c) => {
      await refreshWaiter(c, this.provider, me, ctx);
      const { rows: f } = await c.query<{ n: number }>(
        "select count(*)::int n from public.provider_slots where provider = $1 and slot < $2 and (holder is null or expires_at < now())",
        [this.provider, this.slots],
      );
      const usage = `select holder_ws workspace_id, count(*)::int n from public.provider_slots where provider = $1 and holder is not null and expires_at > now() group by holder_ws`;
      if (!(await admitted(c, this.provider, me, f[0].n, usage))) return null;
      const { rows } = await c.query<{ slot: number }>(
        `update public.provider_slots s set holder = $3, holder_ws = $4, expires_at = now() + make_interval(secs => $5)
          where (s.provider, s.slot) = (
            select provider, slot from public.provider_slots
             where provider = $1 and slot < $2 and (holder is null or expires_at < now())
             order by slot limit 1)
          returning s.slot`,
        [this.provider, this.slots, me, ctx.workspaceId, (this.opts.leaseMs ?? 180_000) / 1000],
      );
      if (rows[0]) await c.query("delete from public.provider_waiters where id = $1", [me]);
      return rows[0]?.slot ?? null;
    });
  }

  async run<T>(fn: () => Promise<T>): Promise<T> {
    await this.ensureRows();
    const ctx = currentJob();
    const me = randomUUID();
    const sleep = this.opts.sleep ?? defaultSleep;
    const t0 = Date.now();
    let slot: number | null;
    try {
      while ((slot = await this.tryAcquire(me, ctx)) === null) await sleep(jitter(this.opts.pollMs ?? 150));
    } catch (e) {
      await this.pool.query("delete from public.provider_waiters where id = $1", [me]).catch(() => {});
      throw e;
    }
    const waited = Date.now() - t0;
    this.stats.calls++;
    this.stats.waitedMs += waited;
    this.stats.maxWaitMs = Math.max(this.stats.maxWaitMs, waited);
    try {
      return await fn();
    } finally {
      await this.pool
        .query("update public.provider_slots set holder = null, holder_ws = null, expires_at = null where provider = $1 and slot = $2 and holder = $3", [this.provider, slot, me])
        .catch(() => {});
    }
  }
}

/** At most N calls per minute per provider, shared by every worker, fairly between workspaces (previews first). */
export class PgRateGate implements Gate {
  readonly stats: GateStats = { calls: 0, waitedMs: 0, maxWaitMs: 0 };
  constructor(
    private readonly pool: pg.Pool,
    readonly provider: string,
    readonly perMinute: number,
    private readonly opts: { now?: () => number; sleep?: (ms: number) => Promise<void>; pollMs?: number } = {},
  ) {}

  private tryTake(me: string, ctx: JobContext, start: Date): Promise<boolean> {
    return inProviderLock(this.pool, this.provider, async (c) => {
      await refreshWaiter(c, this.provider, me, ctx);
      const { rows: used } = await c.query<{ n: number }>("select coalesce(sum(count), 0)::int n from public.provider_window_usage where provider = $1 and window_start = $2", [
        this.provider,
        start,
      ]);
      const usage = `select workspace_id, count n from public.provider_window_usage where provider = $1 and window_start = '${start.toISOString()}'::timestamptz`;
      if (!(await admitted(c, this.provider, me, this.perMinute - used[0].n, usage))) return false;
      await c.query(
        `insert into public.provider_window_usage (provider, window_start, workspace_id, count) values ($1, $2, $3, 1)
         on conflict (provider, window_start, workspace_id) do update set count = public.provider_window_usage.count + 1`,
        [this.provider, start, ctx.workspaceId],
      );
      await c.query("delete from public.provider_waiters where id = $1", [me]);
      return true;
    });
  }

  async run<T>(fn: () => Promise<T>): Promise<T> {
    const now = this.opts.now ?? Date.now;
    const sleep = this.opts.sleep ?? defaultSleep;
    const ctx = currentJob();
    const me = randomUUID();
    const t0 = now();
    for (;;) {
      const start = new Date(Math.floor(now() / 60_000) * 60_000);
      if (await this.tryTake(me, ctx, start)) break;
      // Full this minute: wait for the next one (or for someone ahead to go), checking now and then.
      await sleep(Math.min(Math.max(50, start.getTime() + 60_000 - now()), jitter(this.opts.pollMs ?? 1000)));
    }
    const waited = now() - t0;
    this.stats.calls++;
    this.stats.waitedMs += waited;
    this.stats.maxWaitMs = Math.max(this.stats.maxWaitMs, waited);
    return fn();
  }
}

/** Remove old per-minute counters (housekeeping). */
export async function pruneProviderWindows(pool: pg.Pool): Promise<void> {
  await pool.query("delete from public.provider_window_usage where window_start < now() - interval '1 hour'");
  await pool.query("delete from public.provider_windows where window_start < now() - interval '1 hour'");
  await pool.query("delete from public.provider_waiters where expires_at < now() - interval '1 minute'");
}

// ---- Workspace concurrency ---------------------------------------------------------------

/** The limit for a workspace: its own setting, else the level from the credits it bought. */
export async function workspaceLimit(pool: pg.Pool, workspaceId: string, levelFor: (purchased: number) => number): Promise<number> {
  const { rows } = await pool.query<{ concurrency_limit: number | null; purchased: number }>(
    "select w.concurrency_limit, coalesce(b.purchased, 0)::int purchased from public.workspaces w left join public.workspace_balance b on b.workspace_id = w.id where w.id = $1",
    [workspaceId],
  );
  return rows[0]?.concurrency_limit ?? levelFor(rows[0]?.purchased ?? 0);
}

/** A free preview may go this many leads over the workspace's limit, so it stays fast during a big run. */
export const PREVIEW_EXTRA = 5;
/** A workspace counts as wanting capacity for this long after it last ran or waited. */
const DEMAND_WINDOW_S = 30;

export type SlotResult = { ok: true } | { ok: false; reason: "workspace_limit" | "fair_share" };

/**
 * Claim one of the workspace's slots for this lead, before any paid call is made. Refused when the
 * workspace is at its own limit, or above its fair share of all workers while other workspaces are
 * waiting (capacity ÷ workspaces that want capacity now). Previews may go PREVIEW_EXTRA over both.
 */
export async function acquireWorkspaceSlot(
  pool: pg.Pool,
  p: { workspaceId: string; leadId: string; workerId: string; limit: number; capacity?: number; preview?: boolean; ttlMs?: number },
): Promise<SlotResult> {
  const c = await pool.connect();
  try {
    await c.query("begin");
    await c.query("select pg_advisory_xact_lock(hashtext('ws-slots'))");
    await c.query("delete from public.workspace_slots where expires_at < now()");
    await c.query(
      "insert into public.workspace_demand (workspace_id, last_wanted_at) values ($1, now()) on conflict (workspace_id) do update set last_wanted_at = now()",
      [p.workspaceId],
    );
    const { rows } = await c.query<{ running: number; active: number }>(
      `select (select count(*)::int from public.workspace_slots where workspace_id = $1 and lead_id <> $2) running,
              (select count(*)::int from public.workspace_demand where last_wanted_at > now() - make_interval(secs => $3)) active`,
      [p.workspaceId, p.leadId, DEMAND_WINDOW_S],
    );
    const { running, active } = rows[0];
    const fairShare = p.capacity ? Math.max(1, Math.ceil(p.capacity / Math.max(1, active))) : Infinity;
    const extra = p.preview ? PREVIEW_EXTRA : 0;
    const refused: SlotResult | null =
      running >= p.limit + extra ? { ok: false, reason: "workspace_limit" } : running >= fairShare + extra ? { ok: false, reason: "fair_share" } : null;
    if (refused) {
      await c.query("commit"); // keep the demand row: this workspace is waiting
      return refused;
    }
    await c.query(
      `insert into public.workspace_slots (lead_id, workspace_id, worker_id, expires_at) values ($1, $2, $3, now() + make_interval(secs => $4))
       on conflict (lead_id) do update set worker_id = excluded.worker_id, expires_at = excluded.expires_at`,
      [p.leadId, p.workspaceId, p.workerId, (p.ttlMs ?? 30 * 60_000) / 1000],
    );
    await c.query("commit");
    return { ok: true };
  } catch (e) {
    await c.query("rollback").catch(() => {});
    throw e;
  } finally {
    c.release();
  }
}

/**
 * Seconds before a lead that had to wait tries again: 1, 2, 4, 8, 16, then every 30. Waiting is a
 * reschedule (a new queue job), never a failed attempt, so it doesn't use up the 3 retries.
 */
export function deferDelaySeconds(deferrals: number): number {
  return Math.min(30, 2 ** Math.max(0, Math.min(deferrals, 5)));
}

/** Live worker capacity (jobs at once across workers seen in the last minute). */
export async function workerCapacity(pool: pg.Pool, perWorker: number): Promise<number> {
  const { rows } = await pool.query<{ n: number }>("select count(*)::int n from public.worker_heartbeats where last_seen_at > now() - interval '1 minute'");
  return Math.max(1, rows[0].n) * perWorker;
}

export async function releaseWorkspaceSlot(pool: pg.Pool, leadId: string): Promise<void> {
  await pool.query("delete from public.workspace_slots where lead_id = $1", [leadId]).catch(() => {});
}

/**
 * Run a periodic task on one worker only (Postgres advisory lock), so several workers don't send the
 * same alert or submit the same batch twice. Returns null when another worker is already running it.
 */
export async function asSingleton<T>(pool: pg.Pool, name: string, fn: () => Promise<T>): Promise<T | null> {
  const c = await pool.connect();
  let locked = false;
  try {
    locked = (await c.query<{ ok: boolean }>("select pg_try_advisory_lock(hashtext($1)) ok", [`singleton:${name}`])).rows[0].ok;
    if (!locked) return null;
    return await fn();
  } finally {
    if (locked) await c.query("select pg_advisory_unlock(hashtext($1))", [`singleton:${name}`]).catch(() => {});
    c.release();
  }
}
