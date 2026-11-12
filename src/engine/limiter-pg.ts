// Limits shared by every worker process, kept in Postgres (Phase 10):
// - PgSlotGate: at most N calls at once per provider (Firecrawl's plan concurrency).
// - PgRateGate: at most N calls per minute per provider (Anthropic's requests per minute).
// - Workspace slots: at most N leads of one workspace in progress at once.
// Holders that crash just let their lease run out. No pg-boss here (engine rule).
import { randomUUID } from "node:crypto";
import type pg from "pg";
import type { Gate } from "./limiter";

const defaultSleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));
const jitter = (ms: number) => ms / 2 + Math.random() * ms;

export type GateStats = { calls: number; waitedMs: number; maxWaitMs: number };

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

  /** Take a free slot (or one whose lease ran out). Returns the slot number, or null when all are busy. */
  private async tryAcquire(holder: string): Promise<number | null> {
    const { rows } = await this.pool.query<{ slot: number }>(
      `update public.provider_slots s set holder = $3, expires_at = now() + make_interval(secs => $4)
        where (s.provider, s.slot) = (
          select provider, slot from public.provider_slots
           where provider = $1 and slot < $2 and (holder is null or expires_at < now())
           order by slot limit 1 for update skip locked)
        returning s.slot`,
      [this.provider, this.slots, holder, (this.opts.leaseMs ?? 180_000) / 1000],
    );
    return rows[0]?.slot ?? null;
  }

  async run<T>(fn: () => Promise<T>): Promise<T> {
    await this.ensureRows();
    const holder = randomUUID();
    const sleep = this.opts.sleep ?? defaultSleep;
    const t0 = Date.now();
    let slot: number | null;
    while ((slot = await this.tryAcquire(holder)) === null) await sleep(jitter(this.opts.pollMs ?? 150));
    const waited = Date.now() - t0;
    this.stats.calls++;
    this.stats.waitedMs += waited;
    this.stats.maxWaitMs = Math.max(this.stats.maxWaitMs, waited);
    try {
      return await fn();
    } finally {
      await this.pool.query("update public.provider_slots set holder = null, expires_at = null where provider = $1 and slot = $2 and holder = $3", [this.provider, slot, holder]).catch(() => {});
    }
  }
}

export class PgRateGate implements Gate {
  readonly stats: GateStats = { calls: 0, waitedMs: 0, maxWaitMs: 0 };
  constructor(
    private readonly pool: pg.Pool,
    readonly provider: string,
    readonly perMinute: number,
    private readonly opts: { now?: () => number; sleep?: (ms: number) => Promise<void> } = {},
  ) {}

  async run<T>(fn: () => Promise<T>): Promise<T> {
    const now = this.opts.now ?? Date.now;
    const sleep = this.opts.sleep ?? defaultSleep;
    const t0 = now();
    for (;;) {
      const start = Math.floor(now() / 60_000) * 60_000;
      const { rows } = await this.pool.query<{ count: number }>(
        `insert into public.provider_windows (provider, window_start, count) values ($1, $2, 1)
         on conflict (provider, window_start) do update set count = public.provider_windows.count + 1
         where public.provider_windows.count < $3
         returning count`,
        [this.provider, new Date(start), this.perMinute],
      );
      if (rows[0]) break;
      await sleep(Math.max(50, start + 60_000 - now()) + Math.random() * 250);
    }
    const waited = now() - t0;
    this.stats.calls++;
    this.stats.waitedMs += waited;
    this.stats.maxWaitMs = Math.max(this.stats.maxWaitMs, waited);
    return fn();
  }
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

/** Claim one of the workspace's slots for this lead. False when the workspace is at its limit. */
export async function acquireWorkspaceSlot(pool: pg.Pool, p: { workspaceId: string; leadId: string; workerId: string; limit: number; ttlMs?: number }): Promise<boolean> {
  const c = await pool.connect();
  try {
    await c.query("begin");
    await c.query("select pg_advisory_xact_lock(hashtext('ws-slots:' || $1))", [p.workspaceId]);
    await c.query("delete from public.workspace_slots where workspace_id = $1 and expires_at < now()", [p.workspaceId]);
    const { rows } = await c.query<{ n: number }>("select count(*)::int n from public.workspace_slots where workspace_id = $1 and lead_id <> $2", [p.workspaceId, p.leadId]);
    if (rows[0].n >= p.limit) {
      await c.query("rollback");
      return false;
    }
    await c.query(
      `insert into public.workspace_slots (lead_id, workspace_id, worker_id, expires_at) values ($1, $2, $3, now() + make_interval(secs => $4))
       on conflict (lead_id) do update set worker_id = excluded.worker_id, expires_at = excluded.expires_at`,
      [p.leadId, p.workspaceId, p.workerId, (p.ttlMs ?? 15 * 60_000) / 1000],
    );
    await c.query("commit");
    return true;
  } catch (e) {
    await c.query("rollback").catch(() => {});
    throw e;
  } finally {
    c.release();
  }
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
