// Admin read model (all workspaces: the caller must have passed requireAdmin).
// Takes a pg Pool, so it is tested on a real Postgres; the page passes the server pool.
import type pg from "pg";
import { costDrift, margin, revenuePerCreditEur, usdToEur, type DriftAlert, type Margin } from "@/lib/admin";

export type DayRow = { day: string; creditsUsed: number; emails: number; costUsd: number; m: Margin };
export type CampaignRow = { id: string; name: string; workspace: string; creditsUsed: number; emails: number; fallbacks: number; costUsd: number; m: Margin };
export type WorkspaceRow = { id: string; name: string; owner: string | null; available: number; spent: number; senderDisabled: boolean; personalShare: number | null; leads: number };

export async function loadAdmin(pool: pg.Pool): Promise<{ perCreditEur: number; days: DayRow[]; campaigns: CampaignRow[]; workspaces: WorkspaceRow[]; drift: DriftAlert; totals: Margin }> {
  const [{ rows: purchases }, { rows: dayRows }, { rows: campRows }, { rows: wsRows }, { rows: driftRows }] = await Promise.all([
    pool.query("select amount credits, note from public.credit_ledger where type = 'purchase'"),
    pool.query(
      `with d as (select generate_series(current_date - 29, current_date, interval '1 day')::date as day)
       select to_char(d.day, 'YYYY-MM-DD') as day,
              coalesce((select sum(amount) from public.credit_ledger x where x.type = 'capture' and x.created_at::date = d.day), 0)::int credits_used,
              coalesce((select count(*) from public.generations g where g.step_no = 1 and not g.is_preview and g.checks->>'status' = 'passed' and g.created_at::date = d.day), 0)::int emails,
              coalesce((select sum(cost_usd) from public.usage_costs u where u.created_at::date = d.day), 0)::float cost_usd
         from d order by d.day desc`,
    ),
    pool.query(
      `select c.id, c.name, w.name ws,
              coalesce((select sum(amount) from public.credit_ledger x where x.type = 'capture' and x.campaign_id = c.id), 0)::int credits_used,
              (select count(*) from public.leads l where l.campaign_id = c.id and l.status = 'done')::int emails,
              (select count(*) from public.leads l where l.campaign_id = c.id and l.status = 'fallback')::int fallbacks,
              coalesce((select sum(cost_usd) from public.usage_costs u where u.campaign_id = c.id), 0)::float cost_usd
         from public.campaigns c join public.workspaces w on w.id = c.workspace_id
        where c.status <> 'draft' order by c.created_at desc limit 100`,
    ),
    pool.query(
      `select w.id, w.name, u.email owner, w.sender_disabled, b.available, b.spent,
              (select count(*) from public.leads l where l.workspace_id = w.id)::int leads,
              (select avg(case when public.is_free_mail_domain(split_part(lower(l.email), '@', 2)) then 1.0 else 0.0 end)
                 from public.leads l where l.workspace_id = w.id)::float personal_share
         from public.workspaces w left join auth.users u on u.id = w.owner_id
         left join public.workspace_balance b on b.workspace_id = w.id
        order by w.created_at desc limit 200`,
    ),
    pool.query(
      `select (created_at > now() - interval '7 days') recent,
              coalesce(sum(cost_usd), 0)::float cost_usd,
              0 emails
         from public.usage_costs where created_at > now() - interval '37 days' group by 1
       union all
       select (g.created_at > now() - interval '7 days'), 0, count(*)::int
         from public.generations g where g.step_no = 1 and not g.is_preview and g.checks->>'status' = 'passed' and g.created_at > now() - interval '37 days' group by 1`,
    ),
  ]);
  const perCreditEur = revenuePerCreditEur(purchases);
  const sum = (recent: boolean) => ({
    costEur: usdToEur(driftRows.filter((r) => r.recent === recent).reduce((s, r) => s + Number(r.cost_usd), 0)),
    emails: driftRows.filter((r) => r.recent === recent).reduce((s, r) => s + Number(r.emails), 0),
  });
  const days = dayRows.map((r) => ({ day: r.day, creditsUsed: r.credits_used, emails: r.emails, costUsd: r.cost_usd, m: margin({ creditsUsed: r.credits_used, emailsWritten: r.emails, costUsd: r.cost_usd }, perCreditEur) }));
  const all = days.reduce((a, d) => ({ creditsUsed: a.creditsUsed + d.creditsUsed, emailsWritten: a.emailsWritten + d.emails, costUsd: a.costUsd + d.costUsd }), { creditsUsed: 0, emailsWritten: 0, costUsd: 0 });
  return {
    perCreditEur,
    days,
    campaigns: campRows.map((r) => ({
      id: r.id,
      name: r.name,
      workspace: r.ws,
      creditsUsed: r.credits_used,
      emails: r.emails,
      fallbacks: r.fallbacks,
      costUsd: r.cost_usd,
      m: margin({ creditsUsed: r.credits_used, emailsWritten: r.emails, costUsd: r.cost_usd }, perCreditEur),
    })),
    workspaces: wsRows.map((r) => ({
      id: r.id,
      name: r.name,
      owner: r.owner,
      available: r.available ?? 0,
      spent: r.spent ?? 0,
      senderDisabled: r.sender_disabled,
      personalShare: r.leads ? r.personal_share : null,
      leads: r.leads,
    })),
    drift: costDrift(sum(true), sum(false)),
    totals: margin(all, perCreditEur),
  };
}
