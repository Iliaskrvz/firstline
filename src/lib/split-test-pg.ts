// Split test, database side: turn it on for a campaign (admin), split the leads when the run starts,
// mark replies as positive (the owner reads replies in their own inbox; FirstLine never does), and
// the numbers per half for /admin. Numbers come from outcome rows, which outlive the 30-day deletion.
import type pg from "pg";
import { assignVariants, halfStats, type HalfStats, type SplitTest } from "./split-test";

/** Turn the split test on (with the plain copy) or off. Only before the run started; the caller checks admin. */
export async function setSplitTest(pool: pg.Pool, input: { campaignId: string; split: SplitTest | null }): Promise<{ error: string } | { ok: true }> {
  const { rows } = await pool.query<{ status: string; started: boolean }>(
    `select c.status, exists (select 1 from public.leads l where l.campaign_id = c.id and l.split_variant is not null) started
       from public.campaigns c where c.id = $1`,
    [input.campaignId],
  );
  const c = rows[0];
  if (!c) return { error: "Campaign not found." };
  if (c.status === "running" || c.status === "done" || c.started) return { error: "The split can only change before the campaign runs." };
  await pool.query("update public.campaigns set split_test = $2 where id = $1", [input.campaignId, input.split ? JSON.stringify(input.split) : null]);
  return { ok: true };
}

/** At run start: give every lead without a half its half. Idempotent: leads that have one keep it. */
export async function assignSplit(pool: pg.Pool, campaignId: string, random?: () => number): Promise<{ holdout: number; firstline: number } | null> {
  const { rows: c } = await pool.query<{ split_test: SplitTest | null }>("select split_test from public.campaigns where id = $1", [campaignId]);
  const split = c[0]?.split_test;
  if (!split) return null;
  const { rows: leads } = await pool.query<{ id: string; status: string; split_variant: string | null }>(
    "select id, status, split_variant from public.leads where campaign_id = $1 order by created_at, id",
    [campaignId],
  );
  if (leads.some((l) => l.split_variant)) {
    // Already split (a second run, e.g. after a stop): only leads added since get a half, kept balanced.
    const open = leads.filter((l) => !l.split_variant);
    const holdoutSoFar = leads.filter((l) => l.split_variant === "holdout").length;
    const target = Math.round(leads.length * split.share);
    const map = assignVariants(open.map((l) => ({ id: l.id, written: false })), open.length ? Math.max(0, Math.min(1, (target - holdoutSoFar) / open.length)) : 0, random);
    for (const [id, v] of map) await pool.query("update public.leads set split_variant = $2 where id = $1", [id, v]);
  } else {
    const map = assignVariants(leads.map((l) => ({ id: l.id, written: l.status === "done" || l.status === "fallback" })), split.share, random);
    for (const [id, v] of map) await pool.query("update public.leads set split_variant = $2 where id = $1", [id, v]);
  }
  const { rows: n } = await pool.query<{ v: string; n: number }>("select split_variant v, count(*)::int n from public.leads where campaign_id = $1 group by 1", [campaignId]);
  return { holdout: n.find((r) => r.v === "holdout")?.n ?? 0, firstline: n.find((r) => r.v === "firstline")?.n ?? 0 };
}

/** Mark a reply as positive (true), not positive (false) or unmarked (null). Only in the caller's workspace. */
export async function markReply(pool: pg.Pool, input: { workspaceId: string; sendId: string; positive: boolean | null }): Promise<boolean> {
  const { rows } = await pool.query<{ lead_id: string }>(
    "update public.sends set reply_positive = $3 where id = $1 and workspace_id = $2 and status = 'replied' returning lead_id",
    [input.sendId, input.workspaceId, input.positive],
  );
  if (!rows[0]) return false;
  await pool.query("update public.outcomes set reply_positive = $2 where lead_id = $1 and replied_at is not null", [rows[0].lead_id, input.positive]);
  return true;
}

export type SplitRow = { campaignId: string; name: string; workspace: string; share: number; holdout: HalfStats; firstline: HalfStats };

/** Per split-test campaign, per half: leads contacted, leads that replied, replies marked positive. */
export async function splitTestStats(pool: pg.Pool): Promise<SplitRow[]> {
  const { rows } = await pool.query<{ id: string; name: string; ws: string; share: number; v: "holdout" | "firstline" | null; contacted: number; replied: number; positive: number }>(
    `select c.id, c.name, w.name ws, (c.split_test->>'share')::float share, o.split_variant v,
            count(distinct o.lead_id) filter (where o.sent_at is not null)::int contacted,
            count(distinct o.lead_id) filter (where o.replied_at is not null)::int replied,
            count(distinct o.lead_id) filter (where o.replied_at is not null and o.reply_positive)::int positive
       from public.campaigns c
       join public.workspaces w on w.id = c.workspace_id
       left join public.outcomes o on o.campaign_id = c.id and o.split_variant is not null
      where c.split_test is not null
      group by c.id, c.name, w.name, c.split_test, o.split_variant, c.created_at
      order by c.created_at desc`,
  );
  const byId = new Map<string, SplitRow>();
  for (const r of rows) {
    const row = byId.get(r.id) ?? {
      campaignId: r.id,
      name: r.name,
      workspace: r.ws,
      share: r.share,
      holdout: halfStats({ contacted: 0, replied: 0, positive: 0 }),
      firstline: halfStats({ contacted: 0, replied: 0, positive: 0 }),
    };
    if (r.v) row[r.v] = halfStats(r);
    byId.set(r.id, row);
  }
  return [...byId.values()];
}
