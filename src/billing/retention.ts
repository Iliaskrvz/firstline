// Data retention (§11): lead data is deleted 30 days after a campaign ends.
// A campaign ends when the user ends it, or by itself after 90 days without any activity
// (no new leads, no generations, no sends). What stays: the campaign row (name, counts),
// the credit ledger and real costs (they are permanent history and hold no personal data).
import type pg from "pg";

export const RETENTION_DAYS = 30;
export const IDLE_END_DAYS = 90;

/** End a campaign: stop sending, release open credits, start the 30-day clock. */
export async function endCampaign(pool: pg.Pool, workspaceId: string, campaignId: string): Promise<boolean> {
  const c = await pool.connect();
  try {
    await c.query("begin");
    const { rowCount } = await c.query(
      "update public.campaigns set status = 'done', ended_at = coalesce(ended_at, now()), send_state = null where id = $1 and workspace_id = $2 and ended_at is null",
      [campaignId, workspaceId],
    );
    if (rowCount) {
      await c.query("update public.sends set status = 'stopped', status_detail = 'Campaign ended' where campaign_id = $1 and status in ('queued', 'paused')", [campaignId]);
      await c.query("update public.leads set status = 'skipped', status_detail = 'Campaign ended' where campaign_id = $1 and status = 'queued'", [campaignId]);
      await c.query("select public.release_campaign_credits($1)", [campaignId]);
    }
    await c.query("commit");
    return !!rowCount;
  } catch (e) {
    await c.query("rollback").catch(() => {});
    throw e;
  } finally {
    c.release();
  }
}

/** Run daily by the worker. Returns how many campaigns were ended and purged. */
export async function runRetention(pool: pg.Pool, now: Date = new Date()): Promise<{ ended: number; purged: number; leadsDeleted: number }> {
  const { rows: idle } = await pool.query(
    `select c.id, c.workspace_id from public.campaigns c
      where c.ended_at is null and c.created_at < $1::timestamptz - make_interval(days => $2)
        and not exists (select 1 from public.leads l where l.campaign_id = c.id and l.created_at > $1::timestamptz - make_interval(days => $2))
        and not exists (select 1 from public.generations g join public.leads l on l.id = g.lead_id where l.campaign_id = c.id and g.created_at > $1::timestamptz - make_interval(days => $2))
        and not exists (select 1 from public.sends s where s.campaign_id = c.id and coalesce(s.sent_at, s.created_at) > $1::timestamptz - make_interval(days => $2))`,
    [now, IDLE_END_DAYS],
  );
  for (const c of idle) await endCampaign(pool, c.workspace_id, c.id);

  const { rows: due } = await pool.query(
    "select id from public.campaigns where ended_at is not null and purged_at is null and ended_at < $1::timestamptz - make_interval(days => $2)",
    [now, RETENTION_DAYS],
  );
  let leadsDeleted = 0;
  for (const c of due) {
    // Generations, sends and batch items go with their leads (foreign keys cascade); costs keep their campaign.
    const r = await pool.query("delete from public.leads where campaign_id = $1", [c.id]);
    leadsDeleted += r.rowCount ?? 0;
    await pool.query("update public.campaigns set purged_at = $2 where id = $1", [c.id, now]);
  }
  return { ended: idle.length, purged: due.length, leadsDeleted };
}
