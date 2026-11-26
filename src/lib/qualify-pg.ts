// Lead qualification (Part B) on Postgres, for the app and the API: the campaign's counts and the
// per-lead "write anyway" (the customer overrides a no_fit / unsure verdict; normal credits apply).
import type pg from "pg";
import { reserveForRun } from "@/billing/db";
import { creditsPerLead, type Depth } from "@/lib/credits";
import { noFitWarning, type TargetCustomer } from "@/lib/target-customer";

export type QualificationSummary = {
  on: boolean;
  target: TargetCustomer | null;
  counts: { fit: number; no_fit: number; unsure: number };
  /** Leads skipped by the check (0 credits): no_fit, plus unsure on strict. */
  skipped: number;
  warning: boolean;
};

export async function qualificationSummary(pool: pg.Pool, workspaceId: string, campaignId: string): Promise<QualificationSummary> {
  const { rows: c } = await pool.query<{ target_customer: TargetCustomer | null }>("select target_customer from public.campaigns where id = $1 and workspace_id = $2", [
    campaignId,
    workspaceId,
  ]);
  const { rows } = await pool.query<{ verdict: string; skipped: boolean; n: number }>(
    `select qualify_verdict verdict, (status = 'skipped' and not qualify_override) skipped, count(*)::int n
       from public.leads where campaign_id = $1 and workspace_id = $2 and qualify_verdict is not null group by 1, 2`,
    [campaignId, workspaceId],
  );
  const counts = { fit: 0, no_fit: 0, unsure: 0 };
  let skipped = 0;
  for (const r of rows) {
    counts[r.verdict as keyof typeof counts] += r.n;
    if (r.skipped && r.verdict !== "fit") skipped += r.n;
  }
  const target = c[0]?.target_customer ?? null;
  return { on: !!target, target, counts, skipped, warning: noFitWarning(counts) };
}

/** enqueue: "run" = write now with credits; "preview" = a preview lead, written free like the rest of the preview. */
export type WriteAnywayResult = { error: string } | { ok: true; enqueue: "run" | "preview" | null; credits: number };

/**
 * "Write anyway": the lead skips qualification from now on and goes back in the queue. While the
 * campaign is running (or has run) its credits are reserved now and the caller enqueues it; before
 * the run, the run itself picks it up. Only for leads the check skipped.
 */
export async function writeAnyway(pool: pg.Pool, input: { workspaceId: string; leadId: string; deepOn: boolean }): Promise<WriteAnywayResult> {
  const { rows } = await pool.query<{ status: string; qualify_verdict: string | null; qualify_override: boolean; domain: string | null; preview_rank: number | null; c_status: string; depth: Depth | null; campaign_id: string }>(
    `select l.status, l.qualify_verdict, l.qualify_override, l.domain, l.preview_rank, c.status c_status, c.depth, c.id campaign_id
       from public.leads l join public.campaigns c on c.id = l.campaign_id
      where l.id = $1 and l.workspace_id = $2`,
    [input.leadId, input.workspaceId],
  );
  const l = rows[0];
  if (!l) return { error: "Lead not found." };
  if (l.status !== "skipped" || !l.qualify_verdict || l.qualify_verdict === "fit" || l.qualify_override) return { error: "This lead wasn't skipped by the fit check." };
  const started = l.c_status === "running" || l.c_status === "done";
  let credits = 0;
  if (started && l.domain) {
    const { rows: s } = await pool.query<{ n: number }>("select count(*)::int n from public.sequence_steps where campaign_id = $1 and kind = 'personalised'", [l.campaign_id]);
    const perLead = creditsPerLead({ deep: !!l.depth?.deep && input.deepOn }) + (s[0]?.n ?? 0);
    const r = await reserveForRun(pool, { workspaceId: input.workspaceId, leadIds: [input.leadId], perLead });
    if (!r.ok) return { error: `Writing this lead needs up to ${r.need} credits and you have ${r.available}.` };
    credits = r.credits;
  }
  await pool.query("update public.leads set qualify_override = true, status = 'queued', status_detail = null, confidence = null where id = $1", [input.leadId]);
  return { ok: true, enqueue: started ? "run" : l.preview_rank != null ? "preview" : null, credits };
}
