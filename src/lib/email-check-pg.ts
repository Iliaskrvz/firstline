// Free email checks against the database: the 7-day DNS cache per domain, checking leads (in the
// worker, never in the upload request), and the "exclude risky" / "include again" choices.
// Invalid leads are skipped and never use credits; a reservation they had is released.
import type pg from "pg";
import { combine, REASON_LABEL, staticCheck, summarise, type DomainResult, type EmailReason, type EmailStatus } from "./email-check";
import { classifyDomain, type MxResolver } from "./email-dns";

export const DOMAIN_TTL_DAYS = 7;
/** A failed lookup (timeout, server error) is tried again much sooner. */
export const UNKNOWN_TTL_MS = 60 * 60_000;
export const INVALID_DETAIL = "Invalid email: ";

/** Give back a lead's open reservation, if it has one (release_credits raises when there was never one). */
async function releaseIfReserved(pool: pg.Pool | pg.PoolClient, leadId: string) {
  await pool.query(
    `select public.release_credits(l.id) from public.leads l
      where l.id = $1 and exists (select 1 from public.credit_ledger cl where cl.lead_id = l.id and cl.type = 'reserve')`,
    [leadId],
  );
}
export const EXCLUDED_DETAIL = "Excluded: ";

/** DNS results for these domains: from the cache when fresh, else looked up (a few at a time) and stored. */
export async function lookupDomains(
  pool: pg.Pool,
  resolver: MxResolver,
  domains: string[],
  opts: { now?: Date; concurrency?: number } = {},
): Promise<Map<string, DomainResult>> {
  const now = opts.now ?? new Date();
  const wanted = [...new Set(domains.filter(Boolean))];
  const out = new Map<string, DomainResult>();
  if (!wanted.length) return out;
  const { rows } = await pool.query<{ domain: string; result: DomainResult; checked_at: Date }>(
    "select domain, result, checked_at from public.email_domain_checks where domain = any($1::text[])",
    [wanted],
  );
  for (const r of rows) {
    const age = now.getTime() - new Date(r.checked_at).getTime();
    if (age < (r.result === "unknown" ? UNKNOWN_TTL_MS : DOMAIN_TTL_DAYS * 86_400_000)) out.set(r.domain, r.result);
  }
  const todo = wanted.filter((d) => !out.has(d));
  let i = 0;
  const workers = Array.from({ length: Math.min(opts.concurrency ?? 8, todo.length) }, async () => {
    while (i < todo.length) {
      const d = todo[i++];
      const result = await classifyDomain(d, resolver);
      out.set(d, result);
      await pool.query(
        `insert into public.email_domain_checks (domain, result, checked_at) values ($1, $2, $3)
         on conflict (domain) do update set result = excluded.result, checked_at = excluded.checked_at`,
        [d, result, now],
      );
    }
  });
  await Promise.all(workers);
  return out;
}

type LeadRow = { id: string; email: string; status: string };

/**
 * Check leads: the new ones (pending), and ones whose check is older than 7 days. Invalid leads that
 * haven't started are skipped ("Invalid email: …") and any reservation they had goes back.
 */
export async function checkLeadEmails(
  pool: pg.Pool,
  resolver: MxResolver,
  where: { campaignId?: string; leadIds?: string[] },
  opts: { now?: Date; recheckOlderThanDays?: number } = {},
): Promise<{ checked: number; invalid: number; risky: number; valid: number }> {
  const now = opts.now ?? new Date();
  const { rows } = await pool.query<LeadRow>(
    `select id, email, status from public.leads
      where ${where.leadIds ? "id = any($1::uuid[])" : "campaign_id = $1"}
        and (email_status = 'pending' or email_checked_at is null
             or email_checked_at < $2::timestamptz - make_interval(days => $3))`,
    [where.leadIds ?? where.campaignId, now, opts.recheckOlderThanDays ?? DOMAIN_TTL_DAYS],
  );
  const out = { checked: rows.length, invalid: 0, risky: 0, valid: 0 };
  if (!rows.length) return out;
  const checks = rows.map((r) => ({ row: r, s: staticCheck(r.email) }));
  const dns = await lookupDomains(pool, resolver, checks.filter((c) => c.s.domain && !c.s.invalid.length).map((c) => c.s.domain!), { now });
  for (const { row, s } of checks) {
    const v = combine(s, s.domain ? (dns.get(s.domain) ?? null) : null);
    if (v.status === "pending") continue; // only possible without a domain result; stays for the next round
    if (v.status === "invalid") out.invalid++;
    else if (v.status === "risky") out.risky++;
    else out.valid++;
    await saveVerdict(pool, row, v.status, v.reason, v.reasons, v.suggestion, now);
  }
  return out;
}

async function saveVerdict(
  pool: pg.Pool | pg.PoolClient,
  row: LeadRow,
  status: EmailStatus,
  reason: EmailReason | null,
  reasons: EmailReason[],
  suggestion: string | null,
  now: Date,
  opts: { release?: boolean } = { release: true },
) {
  await pool.query(
    `update public.leads set email_status = $2, email_reason = $3, email_reasons = $4, email_suggestion = $5, email_checked_at = $6,
            status = case when $2 = 'invalid' and status in ('queued', 'failed') then 'skipped' else status end,
            status_detail = case when $2 = 'invalid' and status in ('queued', 'failed') then $7 else status_detail end
      where id = $1`,
    [row.id, status, reason, reasons, suggestion, now, `${INVALID_DETAIL}${reason ? REASON_LABEL[reason].toLowerCase() : "invalid"}`],
  );
  // A lead checked after its run started may hold a reservation: give it back.
  if (status === "invalid" && opts.release) await releaseIfReserved(pool, row.id);
}

/**
 * Right after leads are inserted (CSV import, API): what we can tell without the network. Invalid
 * ones are skipped straight away; the rest wait for the DNS check in the worker.
 */
export async function applyStaticChecks(c: pg.Pool | pg.PoolClient, leads: { id: string; email: string }[], now = new Date()) {
  for (const l of leads) {
    const s = staticCheck(l.email);
    const v = combine(s, null);
    // Just inserted: nothing is reserved yet, so nothing to release (and this may run inside the caller's transaction).
    if (v.status === "invalid") await saveVerdict(c, { id: l.id, email: l.email, status: "queued" }, "invalid", v.reason, v.reasons, v.suggestion, now, { release: false });
    else if (v.reasons.length || v.suggestion) {
      await c.query("update public.leads set email_reasons = $2, email_suggestion = $3 where id = $1", [l.id, v.reasons, v.suggestion]);
    }
  }
}

export type EmailCheckSummary = {
  byStatus: Record<EmailStatus, number>;
  byReason: Partial<Record<EmailReason, number>>;
  /** Risky leads the user excluded (they can be brought back). */
  excluded: number;
  suggestions: { email: string; suggestion: string }[];
};

export async function emailCheckSummary(pool: pg.Pool, workspaceId: string, campaignId: string): Promise<EmailCheckSummary> {
  const { rows } = await pool.query<{ email: string; email_status: EmailStatus; email_reasons: EmailReason[]; email_suggestion: string | null; status: string; status_detail: string | null }>(
    "select email, email_status, email_reasons, email_suggestion, status, status_detail from public.leads where campaign_id = $1 and workspace_id = $2",
    [campaignId, workspaceId],
  );
  const s = summarise(rows.map((r) => ({ status: r.email_status, reasons: r.email_reasons })));
  return {
    ...s,
    excluded: rows.filter((r) => r.status === "skipped" && r.status_detail?.startsWith(EXCLUDED_DETAIL)).length,
    suggestions: rows.filter((r) => r.email_suggestion).slice(0, 20).map((r) => ({ email: r.email, suggestion: r.email_suggestion! })),
  };
}

/** "Exclude all risky" / "Exclude this reason": leads not started yet are skipped, free. */
export async function excludeRisky(
  pool: pg.Pool,
  workspaceId: string,
  campaignId: string,
  reason: EmailReason | null,
  opts: { includePending?: boolean } = {},
): Promise<number> {
  // On the upload screen the DNS check hasn't run yet: leads still "pending" with that reason count too.
  const { rows } = await pool.query<{ id: string }>(
    `update public.leads set status = 'skipped', status_detail = $4 || coalesce($3, email_reason, email_reasons[1])
      where campaign_id = $1 and workspace_id = $2 and status in ('queued', 'failed')
        and (email_status = 'risky' or ($5::boolean and email_status = 'pending' and cardinality(email_reasons) > 0))
        and ($3::text is null or $3 = any(email_reasons))
      returning id`,
    [campaignId, workspaceId, reason, EXCLUDED_DETAIL, !!opts.includePending],
  );
  for (const r of rows) await releaseIfReserved(pool, r.id);
  return rows.length;
}

/** "Include again": excluded risky leads come back (never invalid ones). */
export async function includeExcluded(pool: pg.Pool, workspaceId: string, campaignId: string): Promise<number> {
  const r = await pool.query(
    `update public.leads set status = 'queued', status_detail = null
      where campaign_id = $1 and workspace_id = $2 and status = 'skipped' and status_detail like $3 || '%' and email_status <> 'invalid'`,
    [campaignId, workspaceId, EXCLUDED_DETAIL],
  );
  return r.rowCount ?? 0;
}

/**
 * The worker's check round: new leads waiting for their DNS check (uploads, API, n8n, Make), then leads
 * whose first email is queued but whose check is older than 7 days (the pre-send re-check).
 */
export async function emailCheckTick(pool: pg.Pool, resolver: MxResolver, opts: { now?: Date; batch?: number } = {}) {
  const now = opts.now ?? new Date();
  const batch = opts.batch ?? 2000;
  const { rows: pending } = await pool.query<{ id: string }>(
    "select id from public.leads where email_status = 'pending' order by created_at limit $1",
    [batch],
  );
  const fresh = pending.length ? await checkLeadEmails(pool, resolver, { leadIds: pending.map((r) => r.id) }, { now }) : null;
  const { rows: stale } = await pool.query<{ id: string }>(
    `select distinct l.id from public.sends s join public.leads l on l.id = s.lead_id
      where s.status = 'queued' and s.step_no = 1
        and (l.email_checked_at is null or l.email_checked_at < $1::timestamptz - make_interval(days => $2))
      limit $3`,
    [now, DOMAIN_TTL_DAYS, batch],
  );
  const recheck = stale.length ? await checkLeadEmails(pool, resolver, { leadIds: stale.map((r) => r.id) }, { now }) : null;
  return { checked: (fresh?.checked ?? 0) + (recheck?.checked ?? 0), invalid: (fresh?.invalid ?? 0) + (recheck?.invalid ?? 0) };
}
