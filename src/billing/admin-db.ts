// Admin read model (all workspaces: the caller must have passed requireAdmin).
// Takes a pg Pool, so it is tested on a real Postgres; the page passes the server pool.
import type pg from "pg";
import { costDrift, margin, revenuePerCreditEur, usdToEur, type DriftAlert, type Margin } from "@/lib/admin";
import { noFitWarning } from "@/lib/target-customer";

export type DayRow = { day: string; creditsUsed: number; emails: number; costUsd: number; m: Margin };
export type CampaignRow = { id: string; name: string; workspace: string; creditsUsed: number; emails: number; fallbacks: number; costUsd: number; m: Margin };
export type WorkspaceRow = {
  id: string;
  name: string;
  owner: string | null;
  available: number;
  spent: number;
  senderDisabled: boolean;
  personalShare: number | null;
  leads: number;
  /** Leads in progress at once: own setting (null = automatic from credits bought) and the automatic level. */
  concurrencyLimit: number | null;
  purchased: number;
};

export async function loadAdmin(pool: pg.Pool): Promise<{ perCreditEur: number; days: DayRow[]; campaigns: CampaignRow[]; workspaces: WorkspaceRow[]; drift: DriftAlert; totals: Margin }> {
  const [{ rows: purchases }, { rows: dayRows }, { rows: campRows }, { rows: wsRows }, { rows: driftRows }] = await Promise.all([
    pool.query("select amount credits, note from public.credit_ledger where type = 'purchase'"),
    pool.query(
      `with d as (select generate_series(current_date - 29, current_date, interval '1 day')::date as day)
       select to_char(d.day, 'YYYY-MM-DD') as day,
              coalesce((select sum(amount) from public.credit_ledger x where x.type = 'capture' and x.created_at::date = d.day and x.workspace_id not in (select workspace_id from public.workspace_llm_overrides)), 0)::int credits_used,
              coalesce((select count(*) from public.generations g where g.step_no = 1 and not g.is_preview and g.checks->>'status' = 'passed' and g.created_at::date = d.day and g.workspace_id not in (select workspace_id from public.workspace_llm_overrides)), 0)::int emails,
              coalesce((select sum(cost_usd) from public.usage_costs u where u.created_at::date = d.day and u.bakeoff_run_id is null and u.qualify_test_run_id is null and u.demo_run_id is null and not u.own_use), 0)::float cost_usd
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
      `select w.id, w.name, u.email owner, w.sender_disabled, w.concurrency_limit, b.purchased, b.available, b.spent,
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
         from public.usage_costs where created_at > now() - interval '37 days' and bakeoff_run_id is null and qualify_test_run_id is null and demo_run_id is null and not own_use group by 1
       union all
       select (g.created_at > now() - interval '7 days'), 0, count(*)::int
         from public.generations g where g.step_no = 1 and not g.is_preview and g.checks->>'status' = 'passed' and g.created_at > now() - interval '37 days'
          and g.workspace_id not in (select workspace_id from public.workspace_llm_overrides) group by 1`,
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
      concurrencyLimit: r.concurrency_limit ?? null,
      purchased: r.purchased ?? 0,
      personalShare: r.leads ? r.personal_share : null,
      leads: r.leads,
    })),
    drift: costDrift(sum(true), sum(false)),
    totals: margin(all, perCreditEur),
  };
}

export type RefundRow = { at: string; workspaceId: string; workspace: string; pack: string | null; refunded: string | null; order: string | null; credits: number | null };

/** Payment refunds in the last 90 days (from the activity log). Credits are not taken back automatically. */
export async function loadRefunds(pool: pg.Pool): Promise<RefundRow[]> {
  const { rows } = await pool.query(
    `select a.created_at, a.workspace_id, w.name, a.target, a.details
       from public.activity_log a join public.workspaces w on w.id = a.workspace_id
      where a.action = 'payment.refunded' and a.created_at > now() - interval '90 days'
      order by a.created_at desc limit 50`,
  );
  return rows.map((r) => ({
    at: new Date(r.created_at).toISOString(),
    workspaceId: r.workspace_id,
    workspace: r.name,
    pack: r.target,
    refunded: r.details?.refunded ?? null,
    order: r.details?.order ?? null,
    credits: r.details?.credits ?? null,
  }));
}

/** "lab": Quality Lab, bake-offs, qualification tests and own use (the owner's workspace on Claude). */
export type CostBreakdownRow = { step: string; model: string; source: "customers" | "lab" | "demo"; calls: number; inputTokens: number; outputTokens: number; costUsd: number; share: number };

/**
 * Where the money goes: real cost per step and per model (usage_costs), last `days` days. "lab" rows are
 * the Quality Lab and model bake-offs; they are left out of the customer margin figures above.
 */
export async function loadCostBreakdown(pool: pg.Pool, days = 30): Promise<CostBreakdownRow[]> {
  const { rows } = await pool.query<{ step: string; model: string | null; lab: boolean; demo: boolean; calls: number; input_tokens: number; output_tokens: number; cost_usd: number }>(
    `select step, model, (bakeoff_run_id is not null or qualify_test_run_id is not null or own_use) lab, (demo_run_id is not null) demo, count(*)::int calls,
            coalesce(sum(input_tokens), 0)::float input_tokens, coalesce(sum(output_tokens), 0)::float output_tokens, coalesce(sum(cost_usd), 0)::float cost_usd
       from public.usage_costs where created_at > now() - make_interval(days => $1)
      group by 1, 2, 3, 4 order by cost_usd desc`,
    [days],
  );
  const total = rows.reduce((s, r) => s + r.cost_usd, 0);
  return rows.map((r) => ({
    step: r.step,
    model: r.model ?? "unknown",
    source: r.lab ? "lab" : r.demo ? "demo" : "customers",
    calls: r.calls,
    inputTokens: r.input_tokens,
    outputTokens: r.output_tokens,
    costUsd: r.cost_usd,
    share: total ? r.cost_usd / total : 0,
  }));
}

/**
 * Lead qualification (Part B): leads the fit check skipped for free (no_fit, or unsure on strict) and
 * everything they cost us (research, extraction and the qualify call), over the last `days`.
 */
export async function loadFreeSkips(pool: pg.Pool, days = 30): Promise<{ leads: number; costUsd: number }> {
  const { rows } = await pool.query<{ leads: number; cost_usd: number }>(
    `select count(distinct l.id)::int leads, coalesce(sum(u.cost_usd), 0)::float cost_usd
       from public.leads l
       left join public.usage_costs u on u.lead_id = l.id
      where l.status = 'skipped' and not l.qualify_override and l.qualify_verdict in ('no_fit', 'unsure')
        and l.created_at > now() - make_interval(days => $1)`,
    [days],
  );
  return { leads: rows[0]?.leads ?? 0, costUsd: rows[0]?.cost_usd ?? 0 };
}

/** Campaigns where more than half of at least 10 qualified leads are no_fit (the customer sees the same warning). */
export async function loadNoFitCampaigns(pool: pg.Pool): Promise<{ id: string; name: string; workspace: string; fit: number; noFit: number; unsure: number }[]> {
  const { rows } = await pool.query<{ id: string; name: string; workspace: string; fit: number; no_fit: number; unsure: number }>(
    `select c.id, c.name, w.name workspace,
            count(*) filter (where l.qualify_verdict = 'fit')::int fit,
            count(*) filter (where l.qualify_verdict = 'no_fit')::int no_fit,
            count(*) filter (where l.qualify_verdict = 'unsure')::int unsure
       from public.campaigns c
       join public.workspaces w on w.id = c.workspace_id
       join public.leads l on l.campaign_id = c.id and l.qualify_verdict is not null
      group by c.id, c.name, w.name`,
  );
  return rows
    .filter((r) => noFitWarning({ fit: r.fit, no_fit: r.no_fit, unsure: r.unsure }))
    .map((r) => ({ id: r.id, name: r.name, workspace: r.workspace, fit: r.fit, noFit: r.no_fit, unsure: r.unsure }));
}
