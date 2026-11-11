// Push data layer (§8 Lane B): integrations, pushes in batches with retries and resume,
// tool events (webhook or polling) processed exactly once, outcome rows.
// Framework-agnostic: takes a pg Pool and an adapter factory; no pg-boss, no Next.js.
import { createHash } from "node:crypto";
import type pg from "pg";
import { decryptSecret, encryptSecret } from "@/lib/secret-box";
import { variablesFor, type VariableMapping } from "./fields";
import { ToolError, type Provider, type PushLead, type PushOutcome, type SendingTool, type ToolEvent } from "./types";

export const DRY_RUN_LEADS = 5;
export const LEASE_MS = 2 * 60_000;
export const POLL_EVERY_MS = 15 * 60_000;
const RATE_LIMIT_TRIES = 8;
const TRANSIENT_TRIES = 5;

export type IntegrationRow = {
  id: string;
  workspace_id: string;
  provider: Provider;
  status: string;
  key_hint: string | null;
  account_name: string | null;
  capabilities: { webhooks?: boolean; reason?: string };
  tool_webhook_ids: string[];
  last_checked_at: Date | null;
  last_error: string | null;
  last_polled_at: Date | null;
};

export type ToolFactory = (provider: Provider, apiKey: string) => SendingTool;
export type PushDeps = { toolFor: ToolFactory; key: Buffer; sleep?: (ms: number) => Promise<void>; log?: (...a: unknown[]) => void };

const sha = (s: string) => createHash("sha256").update(s).digest("hex");
const defaultSleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

async function tx<T>(pool: pg.Pool, fn: (c: pg.PoolClient) => Promise<T>): Promise<T> {
  const c = await pool.connect();
  try {
    await c.query("begin");
    const r = await fn(c);
    await c.query("commit");
    return r;
  } catch (e) {
    await c.query("rollback").catch(() => {});
    throw e;
  } finally {
    c.release();
  }
}

// ---- Integrations ---------------------------------------------------------------------

const INTEGRATION_COLS = "id, workspace_id, provider, status, key_hint, account_name, capabilities, tool_webhook_ids, last_checked_at, last_error, last_polled_at";

export async function listIntegrations(pool: pg.Pool, workspaceId: string): Promise<IntegrationRow[]> {
  const { rows } = await pool.query<IntegrationRow>(`select ${INTEGRATION_COLS} from public.integrations where workspace_id = $1 and status <> 'disconnected' order by provider`, [workspaceId]);
  return rows;
}

/** Save a tested key (encrypted) and a fresh webhook token (encrypted). Returns the integration id and the plain token for the URL. */
export async function saveIntegration(
  pool: pg.Pool,
  key: Buffer,
  i: { workspaceId: string; provider: Provider; apiKey: string; keyHint: string; accountName: string | null; webhookToken: string },
): Promise<string> {
  const { rows } = await pool.query<{ id: string }>(
    `insert into public.integrations (workspace_id, provider, api_key_encrypted, webhook_secret, key_hint, account_name, status, capabilities, tool_webhook_ids, last_checked_at, last_error, updated_at)
     values ($1, $2, $3, $4, $5, $6, 'connected', '{}', '{}', now(), null, now())
     on conflict (workspace_id, provider) do update set api_key_encrypted = excluded.api_key_encrypted, webhook_secret = excluded.webhook_secret,
       key_hint = excluded.key_hint, account_name = excluded.account_name, status = 'connected', capabilities = '{}', tool_webhook_ids = '{}',
       last_checked_at = now(), last_error = null, updated_at = now()
     returning id`,
    [i.workspaceId, i.provider, encryptSecret(i.apiKey, key), encryptSecret(i.webhookToken, key), i.keyHint, i.accountName],
  );
  return rows[0].id;
}

export async function setCapabilities(pool: pg.Pool, integrationId: string, cap: { webhooks: boolean; reason?: string }, webhookIds: string[]) {
  await pool.query("update public.integrations set capabilities = $2, tool_webhook_ids = $3, updated_at = now() where id = $1", [integrationId, JSON.stringify(cap), webhookIds]);
}

/** The decrypted API key, or null when the integration is gone. Server only. */
export async function integrationSecret(pool: pg.Pool, key: Buffer, integrationId: string): Promise<{ row: IntegrationRow; apiKey: string; webhookToken: string | null } | null> {
  const { rows } = await pool.query<IntegrationRow & { api_key_encrypted: string | null; webhook_secret: string | null }>(
    `select ${INTEGRATION_COLS}, api_key_encrypted, webhook_secret from public.integrations where id = $1 and status <> 'disconnected'`,
    [integrationId],
  );
  const r = rows[0];
  if (!r?.api_key_encrypted) return null;
  const { api_key_encrypted, webhook_secret, ...row } = r;
  return { row, apiKey: decryptSecret(api_key_encrypted, key), webhookToken: webhook_secret ? decryptSecret(webhook_secret, key) : null };
}

export async function disconnectIntegration(pool: pg.Pool, workspaceId: string, integrationId: string) {
  await pool.query(
    `update public.integrations set status = 'disconnected', api_key_encrypted = null, webhook_secret = null, tool_webhook_ids = '{}', updated_at = now()
      where id = $1 and workspace_id = $2`,
    [integrationId, workspaceId],
  );
}

// ---- Pushes ---------------------------------------------------------------------------

export type PushRow = {
  id: string;
  workspace_id: string;
  campaign_id: string;
  integration_id: string;
  provider: Provider;
  tool_campaign_id: string;
  tool_campaign_name: string | null;
  variable_map: VariableMapping[];
  kind: "dry_run" | "full";
  status: "queued" | "running" | "done" | "failed";
  total: number;
  added: number;
  skipped: number;
  failed: number;
  error: string | null;
  created_at: Date;
  finished_at: Date | null;
};

const PUSH_COLS = "id, workspace_id, campaign_id, integration_id, provider, tool_campaign_id, tool_campaign_name, variable_map, kind, status, total, added, skipped, failed, error, created_at, finished_at";

/**
 * Create a dry run (first 5 eligible leads) or a full push (everything not yet added).
 * Written leads only (personalised or neutral fallback). Suppressed contacts and leads already
 * in that tool campaign get a "skipped" row straight away, with the reason.
 */
export async function createPush(
  pool: pg.Pool,
  p: { workspaceId: string; campaignId: string; integrationId: string; toolCampaignId: string; toolCampaignName: string | null; variableMap: VariableMapping[]; kind: "dry_run" | "full"; userId: string | null },
): Promise<{ push: PushRow } | { error: string }> {
  return tx(pool, async (c) => {
    const { rows: integ } = await c.query("select provider from public.integrations where id = $1 and workspace_id = $2 and status = 'connected'", [p.integrationId, p.workspaceId]);
    if (!integ[0]) return { error: "Connect the tool on the Integrations page first." };
    // One open push per campaign and tool campaign at a time.
    await c.query("select pg_advisory_xact_lock(hashtext($1))", [`push:${p.campaignId}:${p.toolCampaignId}`]);
    const { rows: open } = await c.query(
      "select 1 from public.pushes where campaign_id = $1 and tool_campaign_id = $2 and integration_id = $3 and status in ('queued', 'running')",
      [p.campaignId, p.toolCampaignId, p.integrationId],
    );
    if (open[0]) return { error: "A push to this campaign is still running." };

    const { rows: cand } = await c.query<{ id: string; email: string; suppressed: boolean; already: boolean }>(
      `select l.id, lower(l.email) email,
              exists (select 1 from public.suppression s where s.workspace_id = l.workspace_id
                        and (lower(s.email) = lower(l.email) or (s.email is null and s.domain is not null and s.domain = split_part(lower(l.email), '@', 2)))) suppressed,
              exists (select 1 from public.push_items i where i.integration_id = $3 and i.tool_campaign_id = $4 and i.email = lower(l.email) and i.status = 'added') already
         from public.leads l
        where l.campaign_id = $1 and l.workspace_id = $2 and l.status in ('done', 'fallback') and l.email is not null and l.email <> ''
        order by l.created_at, l.id`,
      [p.campaignId, p.workspaceId, p.integrationId, p.toolCampaignId],
    );
    const fresh = cand.filter((l) => !l.suppressed && !l.already);
    const pick = p.kind === "dry_run" ? fresh.slice(0, DRY_RUN_LEADS) : fresh;
    const skippedRows = p.kind === "dry_run" ? [] : cand.filter((l) => l.suppressed || l.already);
    if (!pick.length && !skippedRows.length) {
      return { error: cand.length ? "Every written lead is already in this campaign or on your suppression list." : "No written leads to push yet: run the campaign first." };
    }

    const { rows } = await c.query<PushRow>(
      `insert into public.pushes (workspace_id, campaign_id, integration_id, provider, tool_campaign_id, tool_campaign_name, variable_map, kind, total, created_by)
       values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10) returning ${PUSH_COLS}`,
      [p.workspaceId, p.campaignId, p.integrationId, integ[0].provider, p.toolCampaignId, p.toolCampaignName, JSON.stringify(p.variableMap), p.kind, pick.length + skippedRows.length, p.userId],
    );
    const push = rows[0];
    const ins = (leads: typeof cand, status: string, reason: (l: (typeof cand)[number]) => string | null) =>
      leads.length
        ? c.query(
            `insert into public.push_items (push_id, workspace_id, lead_id, integration_id, tool_campaign_id, email, status, reason)
             select $1, $2, x.id, $3, $4, x.email, $5, x.reason from unnest($6::uuid[], $7::text[], $8::text[]) as x(id, email, reason)`,
            [push.id, p.workspaceId, p.integrationId, p.toolCampaignId, status, leads.map((l) => l.id), leads.map((l) => l.email), leads.map(reason)],
          )
        : null;
    await ins(pick, "pending", () => null);
    await ins(skippedRows, "skipped", (l) => (l.suppressed ? "On your suppression list" : "Already pushed to this campaign"));
    await refreshCounts(c, push.id);
    return { push: (await c.query<PushRow>(`select ${PUSH_COLS} from public.pushes where id = $1`, [push.id])).rows[0] };
  });
}

async function refreshCounts(c: pg.PoolClient | pg.Pool, pushId: string) {
  await c.query(
    `update public.pushes p set total = x.total, added = x.added, skipped = x.skipped, failed = x.failed
       from (select count(*)::int total,
                    count(*) filter (where status = 'added')::int added,
                    count(*) filter (where status = 'skipped')::int skipped,
                    count(*) filter (where status = 'failed')::int failed
               from public.push_items where push_id = $1) x
      where p.id = $1`,
    [pushId],
  );
}

/** Take a queued push, or a running one whose worker died (lease expired). */
export async function claimPush(pool: pg.Pool, pushId: string, now = new Date()): Promise<PushRow | null> {
  const { rows } = await pool.query<PushRow>(
    `update public.pushes set status = 'running', lease_until = $2, started_at = coalesce(started_at, $3)
      where id = $1 and (status = 'queued' or (status = 'running' and (lease_until is null or lease_until < $3)))
      returning ${PUSH_COLS}`,
    [pushId, new Date(now.getTime() + LEASE_MS), now],
  );
  return rows[0] ?? null;
}

/** Pushes that need a worker: queued ones and running ones whose lease ran out (crash). */
export async function pushesToResume(pool: pg.Pool, now = new Date()): Promise<string[]> {
  const { rows } = await pool.query<{ id: string }>(
    `select id from public.pushes where status = 'queued' or (status = 'running' and (lease_until is null or lease_until < $1)) order by created_at limit 20`,
    [now],
  );
  return rows.map((r) => r.id);
}

type ItemForPush = {
  id: string;
  lead_id: string;
  email: string;
  first_name: string | null;
  last_name: string | null;
  company: string | null;
  title: string | null;
  website: string | null;
  attempts: number;
  subject: string | null;
  slot_outputs: Record<string, string> | null;
  full_email: string | null;
  follow_ups: Record<string, string | null> | null;
};

async function pendingItems(pool: pg.Pool, pushId: string, limit: number): Promise<ItemForPush[]> {
  const { rows } = await pool.query<ItemForPush>(
    `select i.id, i.lead_id, i.email, l.first_name, l.last_name, l.company, l.title, coalesce(l.website, l.domain) website, i.attempts,
            g1.subject, g1.slot_outputs, g1.full_email,
            (select jsonb_object_agg(f.step_no::text, f.full_email)
               from (select distinct on (g.step_no) g.step_no, g.full_email from public.generations g
                      where g.lead_id = i.lead_id and g.step_no > 1 order by g.step_no, g.created_at desc) f) follow_ups
       from public.push_items i
       join public.leads l on l.id = i.lead_id
       left join lateral (select g.subject, g.slot_outputs, g.full_email from public.generations g
                           where g.lead_id = i.lead_id and g.step_no = 1 order by g.created_at desc limit 1) g1 on true
      where i.push_id = $1 and i.status = 'pending'
      order by l.created_at, l.id
      limit $2`,
    [pushId, limit],
  );
  return rows;
}

async function applyResults(pool: pg.Pool, push: PushRow, results: PushOutcome[], leadOf: Map<string, string>) {
  await tx(pool, async (c) => {
    const added: string[] = [];
    for (const r of results) {
      await c.query("savepoint item");
      try {
        const res = await c.query(
          `update public.push_items set status = $2, reason = $3, tool_lead_id = $4, attempts = attempts + 1, updated_at = now()
            where id = $1 and status = 'pending'`,
          [r.ref, r.status, r.reason ?? null, r.toolLeadId ?? null],
        );
        if (r.status === "added" && res.rowCount) added.push(leadOf.get(r.ref)!);
      } catch (e) {
        // Same email already added to this tool campaign by another push: a skip, not an error.
        if ((e as { code?: string }).code !== "23505") throw e;
        await c.query("rollback to savepoint item");
        await c.query("update public.push_items set status = 'skipped', reason = 'Already pushed to this campaign', updated_at = now() where id = $1", [r.ref]);
      }
    }
    if (added.length) await c.query("select public.record_outcomes($1::uuid[], 1, $2, 'pushed')", [added, push.provider]);
    await refreshCounts(c, push.id);
    await c.query("update public.pushes set lease_until = $2 where id = $1", [push.id, new Date(Date.now() + LEASE_MS)]);
  });
}

async function failItems(pool: pg.Pool, pushId: string, ids: string[], reason: string) {
  await pool.query("update public.push_items set status = 'failed', reason = $3, attempts = attempts + 1, updated_at = now() where push_id = $1 and id = any($2) and status = 'pending'", [pushId, ids, reason]);
  await refreshCounts(pool, pushId);
}

async function finishPush(pool: pg.Pool, pushId: string, error: string | null) {
  await refreshCounts(pool, pushId);
  await pool.query("update public.pushes set status = $2, error = $3, finished_at = now(), lease_until = null where id = $1", [pushId, error ? "failed" : "done", error]);
}

/** Call the tool, waiting out rate limits and retrying short outages with backoff. */
async function withRetries<T>(fn: () => Promise<T>, deps: PushDeps): Promise<T> {
  const sleep = deps.sleep ?? defaultSleep;
  let rate = 0;
  let transient = 0;
  for (;;) {
    try {
      return await fn();
    } catch (e) {
      if (!(e instanceof ToolError)) throw e;
      if (e.kind === "rate_limit" && ++rate < RATE_LIMIT_TRIES) {
        await sleep(Math.max(e.retryAfterMs ?? 0, 1000 * 2 ** Math.min(rate - 1, 5)));
        continue;
      }
      if (e.kind === "transient" && ++transient < TRANSIENT_TRIES) {
        await sleep(1000 * 2 ** transient);
        continue;
      }
      throw e;
    }
  }
}

/**
 * Run a push to the end. Safe to call twice and after a crash: only pending items are sent,
 * and each batch has a stable idempotency key, so a batch the tool already took is not added twice.
 */
export async function runPush(pool: pg.Pool, pushId: string, deps: PushDeps): Promise<PushRow | null> {
  const push = await claimPush(pool, pushId);
  if (!push) return null;
  const log = deps.log ?? (() => {});
  const secret = await integrationSecret(pool, deps.key, push.integration_id);
  if (!secret) {
    await failItems(pool, push.id, (await pendingItems(pool, push.id, 100_000)).map((i) => i.id), "The integration was disconnected");
    await finishPush(pool, push.id, "The integration was disconnected.");
    return loadPush(pool, push.workspace_id, push.id);
  }
  let tool: SendingTool;
  try {
    tool = deps.toolFor(push.provider, secret.apiKey);
  } catch (e) {
    // E.g. a test key ("fake-…") on a production server: stop with the reason instead of crashing the job.
    await failItems(pool, push.id, (await pendingItems(pool, push.id, 100_000)).map((i) => i.id), (e as Error).message);
    await finishPush(pool, push.id, (e as Error).message);
    return loadPush(pool, push.workspace_id, push.id);
  }
  const variables = push.variable_map.filter((m) => m.variable.trim()).map((m) => m.variable.trim());
  try {
    await withRetries(() => tool.ensureVariables(push.tool_campaign_id, variables), deps);
    for (;;) {
      const items = await pendingItems(pool, push.id, tool.batchSize);
      if (!items.length) break;
      const leads: PushLead[] = items.map((i) => ({
        ref: i.id,
        email: i.email,
        first_name: i.first_name,
        last_name: i.last_name,
        company: i.company,
        title: i.title,
        website: i.website,
        variables: variablesFor(push.variable_map, {
          subject: i.subject,
          slots: i.slot_outputs,
          full_email: i.full_email,
          followUps: Object.fromEntries(Object.entries(i.follow_ups ?? {}).map(([k, v]) => [Number(k), v])),
        }),
      }));
      const key = sha(`${push.id}:${items.map((i) => i.id).join(",")}`);
      try {
        const results = await withRetries(() => tool.pushLeads(push.tool_campaign_id, leads, { idempotencyKey: key }), deps);
        // Anything the tool didn't report on counts as failed, so the loop can't spin.
        const seen = new Set(results.map((r) => r.ref));
        const missing = items.filter((i) => !seen.has(i.id)).map((i): PushOutcome => ({ ref: i.id, status: "failed", reason: "No answer from the tool for this lead" }));
        await applyResults(pool, push, [...results.filter((r) => items.some((i) => i.id === r.ref)), ...missing], new Map(items.map((i) => [i.id, i.lead_id])));
        log(`push ${push.id}: batch of ${items.length} done`);
      } catch (e) {
        if (e instanceof ToolError && (e.kind === "invalid" || e.kind === "rate_limit" || e.kind === "transient")) {
          // This batch failed after retries; the rest can still go. "Retry failed" picks these up later.
          await failItems(pool, push.id, items.map((i) => i.id), e.message);
          log(`push ${push.id}: batch failed: ${e.message}`);
          continue;
        }
        throw e;
      }
    }
    await finishPush(pool, push.id, null);
  } catch (e) {
    const msg = e instanceof ToolError ? e.message : "Unexpected error while pushing.";
    log(`push ${push.id}: stopped: ${(e as Error).message}`);
    await failItems(pool, push.id, (await pendingItems(pool, push.id, 100_000)).map((i) => i.id), msg);
    await finishPush(pool, push.id, msg);
  }
  return loadPush(pool, push.workspace_id, push.id);
}

/** Put the failed leads of a finished push back in the queue. Returns how many. */
export async function retryFailed(pool: pg.Pool, workspaceId: string, pushId: string): Promise<number> {
  return tx(pool, async (c) => {
    const { rows } = await c.query("select status from public.pushes where id = $1 and workspace_id = $2 for update", [pushId, workspaceId]);
    if (!rows[0] || rows[0].status === "queued" || rows[0].status === "running") return 0;
    const r = await c.query("update public.push_items set status = 'pending', reason = null, updated_at = now() where push_id = $1 and status = 'failed'", [pushId]);
    if (!r.rowCount) return 0;
    await c.query("update public.pushes set status = 'queued', error = null, finished_at = null, lease_until = null where id = $1", [pushId]);
    await refreshCounts(c, pushId);
    return r.rowCount;
  });
}

export async function loadPush(pool: pg.Pool, workspaceId: string, pushId: string): Promise<PushRow | null> {
  const { rows } = await pool.query<PushRow>(`select ${PUSH_COLS} from public.pushes where id = $1 and workspace_id = $2`, [pushId, workspaceId]);
  return rows[0] ?? null;
}

export async function campaignPushes(pool: pg.Pool, workspaceId: string, campaignId: string, limit = 10): Promise<PushRow[]> {
  const { rows } = await pool.query<PushRow>(`select ${PUSH_COLS} from public.pushes where campaign_id = $1 and workspace_id = $2 order by created_at desc limit $3`, [campaignId, workspaceId, limit]);
  return rows;
}

export type PushItemView = { email: string; company: string | null; status: string; reason: string | null; replied: boolean; bounced: boolean; unsubscribed: boolean };

export async function pushItems(pool: pg.Pool, workspaceId: string, pushId: string, limit = 500): Promise<PushItemView[]> {
  const { rows } = await pool.query<PushItemView>(
    `select i.email, l.company, i.status, i.reason, i.replied_at is not null replied, i.bounced_at is not null bounced, i.unsubscribed_at is not null unsubscribed
       from public.push_items i join public.leads l on l.id = i.lead_id
      where i.push_id = $1 and i.workspace_id = $2
      order by case i.status when 'failed' then 0 when 'skipped' then 1 when 'pending' then 2 else 3 end, i.email
      limit $3`,
    [pushId, workspaceId, limit],
  );
  return rows;
}

// ---- Tool events (webhooks and polling) ------------------------------------------------

const FLAG: Record<ToolEvent["type"], string> = { sent: "sent_at", replied: "replied_at", bounced: "bounced_at", unsubscribed: "unsubscribed_at" };

export function eventKey(provider: string, e: ToolEvent): string {
  return sha(`${provider}|${e.type}|${e.toolCampaignId}|${e.email.toLowerCase()}`);
}

/**
 * Store each event once (a hash, never the email) and apply it: status flag on the pushed lead,
 * outcome row, and suppression for bounces and unsubscribes. Duplicates and unknown leads are ignored.
 */
export async function applyToolEvents(pool: pg.Pool, integrationId: string, events: ToolEvent[], source: "webhook" | "poll"): Promise<{ applied: number; duplicate: number; unmatched: number }> {
  const out = { applied: 0, duplicate: 0, unmatched: 0 };
  const { rows: integ } = await pool.query<{ provider: string; workspace_id: string }>("select provider, workspace_id from public.integrations where id = $1", [integrationId]);
  if (!integ[0]) return out;
  const { provider, workspace_id } = integ[0];
  for (const e of events) {
    await tx(pool, async (c) => {
      const ins = await c.query(
        "insert into public.integration_events (integration_id, dedupe_key, event_type, source) values ($1, $2, $3, $4) on conflict do nothing returning id",
        [integrationId, eventKey(provider, e), e.type, source],
      );
      if (!ins.rowCount) {
        out.duplicate++;
        return;
      }
      const at = Number.isNaN(Date.parse(e.at)) ? new Date() : new Date(e.at);
      const { rows: items } = await c.query<{ lead_id: string }>(
        `update public.push_items set ${FLAG[e.type]} = coalesce(${FLAG[e.type]}, $4), updated_at = now()
          where integration_id = $1 and tool_campaign_id = $2 and email = $3 and status = 'added'
          returning lead_id`,
        [integrationId, e.toolCampaignId, e.email.toLowerCase(), at],
      );
      if (!items.length) {
        out.unmatched++;
        return;
      }
      await c.query("update public.integration_events set matched = true where id = $1", [ins.rows[0].id]);
      await c.query("select public.record_outcomes($1::uuid[], 1, $2, $3, $4)", [items.map((i) => i.lead_id), provider, e.type, at]);
      if (e.type === "bounced" || e.type === "unsubscribed") {
        await c.query(
          `insert into public.suppression (workspace_id, email, reason)
           select $1, $2, $3 where not exists (select 1 from public.suppression where workspace_id = $1 and lower(email) = $2)`,
          [workspace_id, e.email.toLowerCase(), e.type === "bounced" ? "bounce" : "unsub"],
        );
      }
      out.applied++;
    });
  }
  return out;
}

/** Plans without webhooks: ask the tool every 15 minutes about campaigns we pushed to in the last 60 days. */
export async function pollIntegrations(pool: pg.Pool, deps: PushDeps, now = new Date()): Promise<{ polled: number; applied: number }> {
  const { rows } = await pool.query<{ id: string }>(
    `select id from public.integrations
      where status = 'connected' and coalesce((capabilities->>'webhooks')::boolean, true) = false
        and (last_polled_at is null or last_polled_at < $1)`,
    [new Date(now.getTime() - POLL_EVERY_MS)],
  );
  let applied = 0;
  for (const { id } of rows) {
    const secret = await integrationSecret(pool, deps.key, id);
    if (!secret) continue;
    await pool.query("update public.integrations set last_polled_at = $2 where id = $1", [id, now]);
    const { rows: camps } = await pool.query<{ tool_campaign_id: string }>(
      "select distinct tool_campaign_id from public.push_items where integration_id = $1 and status = 'added' and updated_at > $2::timestamptz - interval '60 days'",
      [id, now],
    );
    const tool = deps.toolFor(secret.row.provider, secret.apiKey);
    for (const c of camps) {
      try {
        const events = await withRetries(() => tool.pollStatus(c.tool_campaign_id), deps);
        applied += (await applyToolEvents(pool, id, events, "poll")).applied;
      } catch (e) {
        await pool.query("update public.integrations set last_error = $2 where id = $1", [id, `Status check failed: ${(e as Error).message}`.slice(0, 300)]);
      }
    }
  }
  return { polled: rows.length, applied };
}
