// Credits (§3, §9): reserve on run start, purchases from Stripe, balance and history.
// Framework-agnostic: takes a pg Pool (the server's own connection; the ledger
// functions are service-only). Capture/release happen in the engine (PgStore).
import type pg from "pg";

export type Balance = { available: number; reserved: number; spent: number };

export async function balance(pool: pg.Pool | pg.PoolClient, workspaceId: string): Promise<Balance> {
  const { rows } = await pool.query("select available, reserved, spent from public.workspace_balance where workspace_id = $1", [workspaceId]);
  return rows[0] ?? { available: 0, reserved: 0, spent: 0 };
}

export type ReserveResult = { ok: true; reserved: number; credits: number } | { ok: false; need: number; available: number };

/**
 * Reserve `perLead` credits for each lead (§3: "campaign start → reserve"). Leads that already hold a
 * reservation (a retried run) aren't charged again. All or nothing: if credits run out half-way
 * (another run at the same moment), what this call reserved is released again.
 */
export async function reserveForRun(pool: pg.Pool, input: { leadIds: string[]; perLead: number; workspaceId: string }): Promise<ReserveResult> {
  if (input.leadIds.length === 0 || input.perLead <= 0) return { ok: true, reserved: 0, credits: 0 };
  const { rows: had } = await pool.query("select distinct lead_id from public.credit_ledger where type = 'reserve' and lead_id = any($1::uuid[])", [
    input.leadIds,
  ]);
  const already = new Set(had.map((r) => r.lead_id as string));
  const fresh = input.leadIds.filter((id) => !already.has(id));
  const need = fresh.length * input.perLead;
  const { available } = await balance(pool, input.workspaceId);
  if (available < need) return { ok: false, need, available };

  const done: string[] = [];
  for (const id of fresh) {
    const { rows } = await pool.query("select public.reserve_credits($1, $2) ok", [id, input.perLead]);
    if (!rows[0].ok) {
      for (const d of done) await pool.query("select public.release_credits($1)", [d]);
      return { ok: false, need, available: (await balance(pool, input.workspaceId)).available };
    }
    done.push(id);
  }
  return { ok: true, reserved: done.length, credits: need };
}

/** Stop a run: leads not started yet are skipped, open reservations come back (§3: "cancel → release"). */
export async function stopRun(pool: pg.Pool, workspaceId: string, campaignId: string): Promise<{ released: number; skipped: number }> {
  const c = await pool.connect();
  try {
    await c.query("begin");
    const { rowCount } = await c.query("update public.campaigns set status = 'cancelled' where id = $1 and workspace_id = $2 and status = 'running'", [
      campaignId,
      workspaceId,
    ]);
    if (!rowCount) {
      await c.query("rollback");
      return { released: 0, skipped: 0 };
    }
    const skipped = await c.query(
      "update public.leads set status = 'skipped', status_detail = 'Run stopped' where campaign_id = $1 and status = 'queued'",
      [campaignId],
    );
    const { rows } = await c.query("select public.release_campaign_credits($1) released", [campaignId]);
    await c.query("commit");
    return { released: rows[0].released, skipped: skipped.rowCount ?? 0 };
  } catch (e) {
    await c.query("rollback").catch(() => {});
    throw e;
  } finally {
    c.release();
  }
}

/**
 * A paid purchase. Idempotent on `key` (e.g. "kelviq:<checkout session id>"), so a repeated webhook adds
 * nothing. The key is stored in credit_ledger.stripe_event_id, the ledger's unique payment-reference column.
 */
export async function addPurchase(pool: pg.Pool, input: { workspaceId: string; credits: number; key: string; note: string }): Promise<boolean> {
  const { rows } = await pool.query("select public.add_purchase($1, $2, $3, $4) added", [input.workspaceId, input.credits, input.key, input.note]);
  return rows[0].added;
}
