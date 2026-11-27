// Own use, database side: the per-workspace switch (admin only) and this month's own-use spend.
import type pg from "pg";

export async function llmOverride(pool: pg.Pool, workspaceId: string): Promise<"anthropic" | null> {
  const { rows } = await pool.query<{ provider: "anthropic" }>("select provider from public.workspace_llm_overrides where workspace_id = $1", [workspaceId]);
  return rows[0]?.provider ?? null;
}

/** Switch a workspace to Claude (provider "anthropic") or back (null). Admin only: the caller checks. */
export async function setLlmOverride(pool: pg.Pool, input: { workspaceId: string; provider: "anthropic" | null; setBy: string }): Promise<void> {
  if (input.provider === null) {
    await pool.query("delete from public.workspace_llm_overrides where workspace_id = $1", [input.workspaceId]);
    return;
  }
  await pool.query(
    `insert into public.workspace_llm_overrides (workspace_id, provider, set_by) values ($1, $2, $3)
     on conflict (workspace_id) do update set provider = excluded.provider, set_by = excluded.set_by, set_at = now()`,
    [input.workspaceId, input.provider, input.setBy],
  );
}

/** Own-use spend in the current calendar month (UTC), in USD. */
export async function ownUseSpendThisMonth(pool: pg.Pool, now = new Date()): Promise<number> {
  const { rows } = await pool.query<{ usd: number }>(
    "select coalesce(sum(cost_usd), 0)::float usd from public.usage_costs where own_use and created_at >= (date_trunc('month', $1::timestamptz at time zone 'UTC') at time zone 'UTC')",
    [now],
  );
  return rows[0].usd;
}

export type OverrideRow = { workspace_id: string; name: string; provider: string; set_by: string; set_at: Date };

export async function listLlmOverrides(pool: pg.Pool): Promise<OverrideRow[]> {
  const { rows } = await pool.query<OverrideRow>(
    "select o.workspace_id, w.name, o.provider, o.set_by, o.set_at from public.workspace_llm_overrides o join public.workspaces w on w.id = o.workspace_id order by o.set_at",
  );
  return rows;
}
