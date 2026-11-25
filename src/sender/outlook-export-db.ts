// The drafts for "Download for Outlook", chosen exactly like the Gmail lane chooses what to send
// (src/sender/db.ts startSending): finished leads, fallbacks only when the campaign sends them, never
// a suppressed address; the same texts and the same opt-out line. Follow-ups get the first email's
// subject without "Re:", because these drafts are new emails, not replies in a thread.
import type pg from "pg";
import { leadVars } from "@/engine/pipeline";
import type { OutlookLead } from "@/lib/outlook-export";
import { composeBody } from "@/lib/sender/messages";
import { renderPlainStep } from "@/lib/sender/sequence";

export type OutlookDrafts = { leads: OutlookLead[]; suppressed: number; skippedFallbacks: number; missingFollowUps: number; leadIds: string[] };

export async function loadOutlookDrafts(
  pool: pg.Pool,
  input: { workspaceId: string; campaignId: string; includeFollowUps: boolean; optOutLine: string | null },
): Promise<OutlookDrafts> {
  const { rows: camp } = await pool.query("select send_fallbacks from public.campaigns where id = $1 and workspace_id = $2", [input.campaignId, input.workspaceId]);
  if (!camp[0]) throw new Error("Campaign not found.");
  const sendFallbacks: boolean = camp[0].send_fallbacks;

  const { rows: leads } = await pool.query(
    `select l.id, l.email, l.first_name, l.last_name, l.company, l.title, l.linkedin_headline, l.website, l.domain, l.custom, l.status,
            g.subject, g.full_email,
            exists (select 1 from public.suppression x where x.workspace_id = l.workspace_id
                     and (lower(x.email) = lower(l.email) or x.domain = split_part(lower(l.email), '@', 2))) suppressed
       from public.leads l
       join lateral (select subject, full_email from public.generations g
                      where g.lead_id = l.id and g.step_no = 1 and g.full_email is not null and g.full_email <> ''
                      order by g.created_at desc limit 1) g on true
      where l.campaign_id = $1 and l.workspace_id = $2 and l.status in ('done', 'fallback')
      order by l.created_at, l.id`,
    [input.campaignId, input.workspaceId],
  );
  const steps = input.includeFollowUps
    ? (
        await pool.query<{ step_no: number; kind: "plain" | "personalised"; template_body: string }>(
          "select step_no, kind, template_body from public.sequence_steps where campaign_id = $1 and step_no > 1 order by step_no",
          [input.campaignId],
        )
      ).rows
    : [];
  const written = steps.length
    ? (
        await pool.query<{ lead_id: string; step_no: number; full_email: string }>(
          `select distinct on (lead_id, step_no) lead_id, step_no, full_email from public.generations
            where lead_id = any($1::uuid[]) and step_no > 1 order by lead_id, step_no, created_at desc`,
          [leads.map((l) => l.id)],
        )
      ).rows
    : [];
  const followUpText = new Map(written.map((g) => [`${g.lead_id}:${g.step_no}`, g.full_email]));

  const out: OutlookDrafts = { leads: [], suppressed: 0, skippedFallbacks: 0, missingFollowUps: 0, leadIds: [] };
  for (const l of leads) {
    if (l.status === "fallback" && !sendFallbacks) {
      out.skippedFallbacks++;
      continue;
    }
    if (l.suppressed) {
      out.suppressed++;
      continue;
    }
    const base = { to: l.email as string, firstName: l.first_name, lastName: l.last_name, company: l.company, subject: (l.subject as string).trim() };
    const vars = leadVars({ ...l, custom: l.custom ?? {} });
    const followUps: OutlookLead["followUps"] = [];
    for (const st of steps) {
      let text: string | undefined;
      try {
        text = st.kind === "plain" ? renderPlainStep(st.template_body, vars) : followUpText.get(`${l.id}:${st.step_no}`);
      } catch {
        text = undefined;
      }
      if (!text) {
        out.missingFollowUps++;
        continue;
      }
      followUps.push({ step: st.step_no, draft: { ...base, text: composeBody(text, input.optOutLine) } });
    }
    out.leads.push({ first: { ...base, text: composeBody(l.full_email, input.optOutLine) }, followUps });
    out.leadIds.push(l.id);
  }
  return out;
}
