// Public API data layer (Phase 9): keys, rate limits, jobs, results. Framework-agnostic (pg Pool);
// the /api/v1 route handlers stay thin. Each call becomes a hidden "api" campaign, so research,
// writing, checks, credits (reserve → capture / release) and the 30-day deletion are the app's own.
import { createHash } from "node:crypto";
import type pg from "pg";
import { reserveForRun } from "@/billing/db";
import { creditsPerLead } from "@/lib/credits";
import { isFreeMailDomain, normaliseDomain } from "@/lib/domain";
import { hasErrors, parseTemplate } from "@/lib/template";
import { ApiError, invalid, notFound } from "./errors";
import { generateApiKey, hashApiKey } from "./keys";
import { RATE_LIMIT_PER_MIN, type LeadInput, type PersonalizeBody } from "./schemas";

const TERMINAL = ["done", "fallback", "failed", "skipped"];

// ---- Keys ------------------------------------------------------------------------------

export type ApiKeyRow = { id: string; name: string; prefix: string; created_at: Date; last_used_at: Date | null; revoked_at: Date | null };

export async function createApiKey(pool: pg.Pool, workspaceId: string, name: string, userId: string | null): Promise<{ key: string; row: ApiKeyRow }> {
  const k = generateApiKey();
  const { rows } = await pool.query<ApiKeyRow>(
    "insert into public.api_keys (workspace_id, name, prefix, key_hash, created_by) values ($1, $2, $3, $4, $5) returning id, name, prefix, created_at, last_used_at, revoked_at",
    [workspaceId, name, k.prefix, k.hash, userId],
  );
  return { key: k.key, row: rows[0] };
}

export async function listApiKeys(pool: pg.Pool, workspaceId: string): Promise<ApiKeyRow[]> {
  const { rows } = await pool.query<ApiKeyRow>(
    "select id, name, prefix, created_at, last_used_at, revoked_at from public.api_keys where workspace_id = $1 order by revoked_at nulls first, created_at desc",
    [workspaceId],
  );
  return rows;
}

export async function revokeApiKey(pool: pg.Pool, workspaceId: string, id: string): Promise<boolean> {
  const r = await pool.query("update public.api_keys set revoked_at = now() where id = $1 and workspace_id = $2 and revoked_at is null", [id, workspaceId]);
  return (r.rowCount ?? 0) > 0;
}

export type ApiCaller = { apiKeyId: string; workspaceId: string };

/** The workspace behind a key, or null. Updates last_used_at at most once a minute. */
export async function authenticate(pool: pg.Pool, key: string): Promise<ApiCaller | null> {
  const { rows } = await pool.query<{ id: string; workspace_id: string; last_used_at: Date | null }>(
    "select id, workspace_id, last_used_at from public.api_keys where key_hash = $1 and revoked_at is null",
    [hashApiKey(key)],
  );
  const r = rows[0];
  if (!r) return null;
  if (!r.last_used_at || Date.now() - r.last_used_at.getTime() > 60_000) {
    await pool.query("update public.api_keys set last_used_at = now() where id = $1", [r.id]);
  }
  return { apiKeyId: r.id, workspaceId: r.workspace_id };
}

/** Fixed one-minute window per key. Throws 429 with Retry-After when over the limit. */
export async function rateLimit(pool: pg.Pool, apiKeyId: string, now = new Date(), limit = RATE_LIMIT_PER_MIN): Promise<Record<string, string>> {
  const start = new Date(Math.floor(now.getTime() / 60_000) * 60_000);
  const { rows } = await pool.query<{ count: number }>(
    `insert into public.api_rate_windows (api_key_id, window_start, count) values ($1, $2, 1)
     on conflict (api_key_id, window_start) do update set count = public.api_rate_windows.count + 1
     returning count`,
    [apiKeyId, start],
  );
  const reset = Math.ceil((start.getTime() + 60_000 - now.getTime()) / 1000);
  const headers = { "X-RateLimit-Limit": String(limit), "X-RateLimit-Remaining": String(Math.max(0, limit - rows[0].count)), "X-RateLimit-Reset": String(Math.floor(start.getTime() / 1000) + 60) };
  if (rows[0].count > limit) {
    throw new ApiError(429, "rate_limited", `Too many requests: ${limit} per minute per API key. Try again in ${reset} seconds.`, undefined, { ...headers, "Retry-After": String(reset) });
  }
  return headers;
}

// ---- Jobs ------------------------------------------------------------------------------

export function requestHash(body: unknown): string {
  return createHash("sha256").update(JSON.stringify(body)).digest("hex");
}

type Source = Pick<PersonalizeBody, "copy" | "campaign_id" | "options">;

/** website → domain; without one, the company domain of the email address (never gmail.com & co). */
export function leadDomain(l: LeadInput): string | null {
  const fromSite = normaliseDomain(l.website);
  if (fromSite) return fromSite;
  const d = l.email.split("@")[1]?.toLowerCase() ?? null;
  return d && !isFreeMailDomain(d) ? normaliseDomain(d) : null;
}

export type CreatedJob = { jobId: string; leadIds: string[]; replayed: boolean };

/**
 * Accept a job: check the copy, create the hidden campaign and its leads, reserve credits (all or
 * nothing), and record the job. With an Idempotency-Key, the same request returns the same job.
 */
export async function createJob(
  pool: pg.Pool,
  caller: ApiCaller,
  input: { kind: "single" | "batch"; leads: LeadInput[]; source: Source; idempotencyKey: string | null; requestHash: string },
): Promise<CreatedJob> {
  if (input.idempotencyKey) {
    const { rows } = await pool.query<{ id: string; request_hash: string }>("select id, request_hash from public.api_jobs where api_key_id = $1 and idempotency_key = $2", [
      caller.apiKeyId,
      input.idempotencyKey,
    ]);
    if (rows[0]) {
      if (rows[0].request_hash !== input.requestHash) {
        throw new ApiError(422, "idempotency_conflict", "This Idempotency-Key was already used with a different request body.");
      }
      return { jobId: rows[0].id, leadIds: [], replayed: true };
    }
  }

  const { source } = input;
  if (source.options.depth.deep || source.options.depth.local) {
    throw new ApiError(400, "not_available", "Deep and Local research are not available yet. Leave options.depth off.");
  }
  if (!source.copy === !source.campaign_id) throw invalid("Send either copy (your email with [[slots]]) or campaign_id, not both.");
  const emails = input.leads.map((l) => l.email.toLowerCase());
  const dup = emails.find((e, i) => emails.indexOf(e) !== i);
  if (dup) throw invalid(`The batch contains ${dup} twice.`);

  const c = await pool.connect();
  let campaignId: string;
  let leadIds: string[];
  let jobId: string;
  try {
    await c.query("begin");
    let templateId: string;
    if (source.campaign_id) {
      const { rows } = await c.query<{ template_id: string | null; subject: string; body: string }>(
        `select c.template_id, t.subject, t.body from public.campaigns c join public.templates t on t.id = c.template_id
          where c.id = $1 and c.workspace_id = $2 and c.source = 'app'`,
        [source.campaign_id, caller.workspaceId],
      );
      if (!rows[0]?.template_id) throw notFound("Campaign not found, or it has no template yet.");
      const tpl = parseTemplate(rows[0]);
      if (hasErrors(tpl) || !tpl.slots.length) throw invalid("That campaign's template has errors or no [[slots]]. Fix it in the app first.");
      templateId = rows[0].template_id;
    } else {
      const copy = source.copy!;
      const tpl = parseTemplate({ subject: copy.subject, body: copy.body });
      if (!tpl.slots.length) throw invalid("copy.body needs at least one [[slot]] for FirstLine to write, e.g. [[opener · something specific from their website · 25]].");
      if (hasErrors(tpl)) throw invalid(`copy has errors: ${tpl.issues.filter((i) => i.level === "error").map((i) => i.message).join("; ")}`);
      const style = copy.style_rules ?? { language: "auto", tone: "", banned_phrases: [], extra_rules: [] };
      const { rows } = await c.query<{ id: string }>(
        "insert into public.templates (workspace_id, name, subject, body, slots, style_rules, source) values ($1, $2, $3, $4, $5, $6, 'api') returning id",
        [caller.workspaceId, "API copy", copy.subject, copy.body, JSON.stringify(tpl.slots), JSON.stringify(style)],
      );
      templateId = rows[0].id;
    }

    const { rows: camp } = await c.query<{ id: string }>(
      `insert into public.campaigns (workspace_id, template_id, name, status, mode, depth, writer, source)
       values ($1, $2, $3, 'running', 'now', $4, $5, 'api') returning id`,
      [caller.workspaceId, templateId, `API ${input.kind} ${new Date().toISOString().slice(0, 16).replace("T", " ")}`, JSON.stringify(source.options.depth), source.options.writer],
    );
    campaignId = camp[0].id;
    const { rows: leads } = await c.query<{ id: string }>(
      `insert into public.leads (workspace_id, campaign_id, email, first_name, last_name, company, title, linkedin_headline, website, domain, custom)
       select $1, $2, x.email, x.first_name, x.last_name, x.company, x.title, x.linkedin_headline, x.website, x.domain, x.custom
         from jsonb_to_recordset($3::jsonb) as x(email text, first_name text, last_name text, company text, title text, linkedin_headline text, website text, domain text, custom jsonb, ord int)
        order by x.ord
       returning id`,
      [
        caller.workspaceId,
        campaignId,
        JSON.stringify(
          input.leads.map((l, ord) => ({
            ord,
            email: l.email.toLowerCase(),
            first_name: l.first_name,
            last_name: l.last_name,
            company: l.company,
            title: l.title,
            linkedin_headline: l.linkedin_headline,
            website: l.website,
            domain: leadDomain(l),
            custom: Object.fromEntries(Object.entries(l.custom ?? {}).filter(([, v]) => v != null).map(([k, v]) => [k, String(v)])),
          })),
        ),
      ],
    );
    leadIds = leads.map((l) => l.id);
    const { rows: job } = await c.query<{ id: string }>(
      `insert into public.api_jobs (workspace_id, api_key_id, campaign_id, kind, lead_count, idempotency_key, request_hash)
       values ($1, $2, $3, $4, $5, $6, $7) returning id`,
      [caller.workspaceId, caller.apiKeyId, campaignId, input.kind, leadIds.length, input.idempotencyKey, input.requestHash],
    );
    jobId = job[0].id;
    await c.query("commit");
  } catch (e) {
    await c.query("rollback").catch(() => {});
    // Two calls with the same Idempotency-Key at the same moment: the second one gets the first's job.
    if ((e as { code?: string }).code === "23505" && input.idempotencyKey) return createJob(pool, caller, input);
    throw e;
  } finally {
    c.release();
  }

  // Credits: leads with a website hold credits until they finish; leads without one fall back for free.
  const { rows: withSite } = await pool.query<{ id: string }>("select id from public.leads where campaign_id = $1 and domain is not null", [campaignId]);
  const reserved = await reserveForRun(pool, { workspaceId: caller.workspaceId, leadIds: withSite.map((r) => r.id), perLead: creditsPerLead(source.options.depth) });
  if (!reserved.ok) {
    await pool.query("delete from public.campaigns where id = $1", [campaignId]); // removes the job and leads too
    throw new ApiError(402, "insufficient_credits", `This needs up to ${reserved.need} credits and the workspace has ${reserved.available}. Buy credits in the app.`, {
      needed: reserved.need,
      available: reserved.available,
    });
  }
  return { jobId, leadIds, replayed: false };
}

export type LeadResult = {
  id: string;
  email: string;
  status: "queued" | "processing" | "personalised" | "fallback" | "failed" | "skipped";
  detail: string | null;
  subject: string | null;
  email_body: string | null;
  slots: Record<string, string> | null;
  sources: { fact: string; url: string }[];
  confidence: string | null;
  credits_used: number;
};

export type JobView = {
  id: string;
  object: "job";
  kind: "single" | "batch";
  status: "running" | "done";
  created_at: string;
  finished_at: string | null;
  lead_count: number;
  counts: Record<LeadResult["status"], number>;
  credits_used: number;
  results: LeadResult[];
};

const STATUS: Record<string, LeadResult["status"]> = { queued: "queued", researching: "processing", writing: "processing", done: "personalised", fallback: "fallback", failed: "failed", skipped: "skipped" };

export async function jobView(pool: pg.Pool, workspaceId: string, jobId: string): Promise<JobView | null> {
  const { rows: jobs } = await pool.query<{ id: string; kind: "single" | "batch"; status: "running" | "done"; created_at: Date; finished_at: Date | null; lead_count: number; campaign_id: string }>(
    "select id, kind, status, created_at, finished_at, lead_count, campaign_id from public.api_jobs where id = $1 and workspace_id = $2",
    [jobId, workspaceId],
  );
  const j = jobs[0];
  if (!j) return null;
  const { rows } = await pool.query<{
    id: string;
    email: string;
    status: string;
    status_detail: string | null;
    confidence: string | null;
    subject: string | null;
    full_email: string | null;
    slot_outputs: Record<string, string> | null;
    facts_used: string[] | null;
    research: { facts?: { id: string; text?: string; src?: string }[] } | null;
    credits: number;
  }>(
    `select l.id, l.email, l.status, l.status_detail, l.confidence, g.subject, g.full_email, g.slot_outputs, g.facts_used, g.research,
            coalesce((select sum(amount) from public.credit_ledger cl where cl.lead_id = l.id and cl.type = 'capture'), 0)::int credits
       from public.leads l
       left join lateral (select subject, full_email, slot_outputs, facts_used, research from public.generations g
                           where g.lead_id = l.id and g.step_no = 1 order by g.created_at desc limit 1) g on true
      where l.campaign_id = $1
      order by l.created_at, l.id`,
    [j.campaign_id],
  );
  const counts = { queued: 0, processing: 0, personalised: 0, fallback: 0, failed: 0, skipped: 0 };
  const results = rows.map((r): LeadResult => {
    const status = STATUS[r.status] ?? "processing";
    counts[status]++;
    const written = status === "personalised" || status === "fallback";
    const facts = new Map((r.research?.facts ?? []).map((f) => [f.id, f]));
    return {
      id: r.id,
      email: r.email,
      status,
      detail: r.status_detail,
      subject: written ? r.subject : null,
      email_body: written ? r.full_email : null,
      slots: written ? r.slot_outputs : null,
      sources: written ? (r.facts_used ?? []).map((id) => facts.get(id)).filter((f): f is { id: string; text?: string; src?: string } => !!f?.src).map((f) => ({ fact: f.text ?? "", url: f.src! })) : [],
      confidence: r.confidence,
      credits_used: r.credits,
    };
  });
  return {
    id: j.id,
    object: "job",
    kind: j.kind,
    status: j.status,
    created_at: j.created_at.toISOString(),
    finished_at: j.finished_at?.toISOString() ?? null,
    lead_count: j.lead_count,
    counts,
    credits_used: results.reduce((a, r) => a + r.credits_used, 0),
    results,
  };
}

/** A lead finished: if it was the last one of an API job, mark the job done and queue its webhooks. */
export async function completeJobsFor(pool: pg.Pool, leadId: string): Promise<string | null> {
  const { rows } = await pool.query<{ id: string }>(
    "select j.id from public.api_jobs j join public.leads l on l.campaign_id = j.campaign_id where l.id = $1 and j.status = 'running'",
    [leadId],
  );
  return rows[0] ? completeJob(pool, rows[0].id) : null;
}

/** Mark a job done when every lead is finished (exactly once), end its hidden campaign, queue webhooks. */
export async function completeJob(pool: pg.Pool, jobId: string): Promise<string | null> {
  const { rows } = await pool.query<{ id: string; workspace_id: string; kind: string; campaign_id: string }>(
    `update public.api_jobs j set status = 'done', finished_at = now()
      where j.id = $1 and j.status = 'running'
        and not exists (select 1 from public.leads l where l.campaign_id = j.campaign_id and l.status <> all($2::text[]))
      returning j.id, j.workspace_id, j.kind, j.campaign_id`,
    [jobId, TERMINAL],
  );
  const j = rows[0];
  if (!j) return null;
  // The hidden campaign ends now, so its lead data is deleted 30 days later (§11).
  await pool.query("update public.campaigns set status = 'done', ended_at = coalesce(ended_at, now()) where id = $1", [j.campaign_id]);
  const view = await jobView(pool, j.workspace_id, j.id);
  const { enqueueWebhookEvent } = await import("./webhooks-pg");
  await enqueueWebhookEvent(pool, j.workspace_id, j.kind === "batch" ? "batch.completed" : "job.completed", j.id, view);
  return j.id;
}

/** Safety net for the worker: finish jobs whose last lead completed without the hook (e.g. a crash). */
export async function completeFinishedJobs(pool: pg.Pool): Promise<number> {
  const { rows } = await pool.query<{ id: string }>(
    `select j.id from public.api_jobs j where j.status = 'running'
        and not exists (select 1 from public.leads l where l.campaign_id = j.campaign_id and l.status <> all($1::text[]))
      limit 50`,
    [TERMINAL],
  );
  let n = 0;
  for (const r of rows) if (await completeJob(pool, r.id)) n++;
  return n;
}

/** Wait up to `seconds` for a job to finish (for n8n users who want the result in the same step). */
export async function waitForJob(pool: pg.Pool, workspaceId: string, jobId: string, seconds: number, sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))): Promise<JobView | null> {
  const until = Date.now() + seconds * 1000;
  let view = await jobView(pool, workspaceId, jobId);
  while (view && view.status !== "done" && Date.now() < until) {
    // The job flips to done when the worker finishes the last lead; check the leads too in case it lags.
    if (view.results.every((r) => ["personalised", "fallback", "failed", "skipped"].includes(r.status))) await completeJob(pool, jobId);
    await sleep(1000);
    view = await jobView(pool, workspaceId, jobId);
  }
  return view;
}

/** Housekeeping: old rate windows and webhook deliveries (they hold results: 30-day rule). */
export async function apiHousekeeping(pool: pg.Pool): Promise<void> {
  await pool.query("delete from public.api_rate_windows where window_start < now() - interval '1 day'");
  await pool.query("delete from public.webhook_deliveries where created_at < now() - interval '30 days'");
}
