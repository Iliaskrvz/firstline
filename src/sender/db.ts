// Sender API data layer (§8). Framework-agnostic: takes a pg Pool, used by the
// /api/sender routes and server actions, and tested on a real Postgres.
// Scheduling decisions are the pure functions in src/lib/sender.
import type pg from "pg";
import { isFreeMailDomain } from "@/lib/domain";
import {
  BOUNCE_SENDER_PATTERN,
  composeBody,
  generateSenderKey,
  hashSenderKey,
  keyPrefix,
  REPLY_CUT_PATTERN,
  UNSUBSCRIBE_PATTERN,
} from "@/lib/sender/messages";
import {
  advanceWarmup,
  LEASE_MS,
  localTime,
  mayHandOut,
  nextGapMs,
  stepBack,
  WAIT_LABEL,
  type SendWindow,
  type WaitReason,
} from "@/lib/sender/schedule";

/** Bump when the Apps Script changes; scripts older than MIN must update before they get work. */
export const SENDER_SCRIPT_VERSION = "1.0.0";
export const MIN_SCRIPT_VERSION = "1.0.0";
const WATCH_PER_RUN = 20; // Gmail read quota: 288 runs/day × 20 threads stays well under it
const WATCH_DAYS = 30;

export class SenderAuthError extends Error {}

export function compareVersions(a: string, b: string): number {
  const pa = a.split(".").map((n) => Number(n) || 0);
  const pb = b.split(".").map((n) => Number(n) || 0);
  for (let i = 0; i < 3; i++) if ((pa[i] ?? 0) !== (pb[i] ?? 0)) return (pa[i] ?? 0) - (pb[i] ?? 0);
  return 0;
}

type InboxRow = {
  id: string;
  workspace_id: string;
  email: string;
  daily_cap: number;
  warmup_day: number;
  window: SendWindow;
  health: string;
  next_send_at: Date | null;
  warmup_updated_on: string | null;
  step_back_on: string | null;
  errors_on: string | null;
  errors_today: number;
  sender_disabled: boolean;
};

async function tx<T>(pool: pg.Pool, fn: (c: pg.PoolClient) => Promise<T>): Promise<T> {
  const c = await pool.connect();
  try {
    await c.query("begin");
    const out = await fn(c);
    await c.query("commit");
    return out;
  } catch (e) {
    await c.query("rollback").catch(() => {});
    throw e;
  } finally {
    c.release();
  }
}

async function lockInbox(c: pg.PoolClient, key: string): Promise<InboxRow> {
  const { rows } = await c.query<InboxRow>(
    `select i.id, i.workspace_id, i.email, i.daily_cap, i.warmup_day, i."window", i.health, i.next_send_at,
            to_char(i.warmup_updated_on, 'YYYY-MM-DD') warmup_updated_on, to_char(i.step_back_on, 'YYYY-MM-DD') step_back_on,
            to_char(i.errors_on, 'YYYY-MM-DD') errors_on, i.errors_today, w.sender_disabled
       from public.inboxes i join public.workspaces w on w.id = i.workspace_id
      where i.sender_key_hash = $1
      for update of i`,
    [hashSenderKey(key)],
  );
  if (!rows[0]) throw new SenderAuthError("Unknown sender key. Copy the key from FirstLine → Inboxes again.");
  return rows[0];
}

/** Start of a local date in the inbox's timezone, as an instant. */
const LOCAL_DAY_START = `($2::date::timestamp at time zone $3)`;

export type NextResponse = {
  email: { send_id: string; to: string; subject: string; body: string; thread_id: string | null } | null;
  wait: { reason: WaitReason; label: string } | null;
  watch: { send_id: string; thread_id: string }[];
  rules: { unsubscribe: string; reply_cut: string; bounce_from: string };
  script: { latest: string; update_required: boolean };
  inbox: { email: string; sent_today: number; cap: number };
};

/** GET /api/sender/next: heartbeat, warm-up bookkeeping, and at most one email (§8, §11). */
export async function senderNext(pool: pg.Pool, key: string, opts: { scriptVersion: string | null; now?: Date }): Promise<NextResponse> {
  const now = opts.now ?? new Date();
  return tx(pool, async (c) => {
    const inbox = await lockInbox(c, key);
    const tz = inbox.window.tz;
    const today = localTime(now, tz).date;
    const outdated = !opts.scriptVersion || compareVersions(opts.scriptVersion, MIN_SCRIPT_VERSION) < 0;

    // Warm-up: one step per new day if the inbox sent since the last step.
    let warmupDay = inbox.warmup_day;
    let warmupOn = inbox.warmup_updated_on ?? today;
    if (inbox.warmup_updated_on !== today) {
      const since = inbox.warmup_updated_on ?? today;
      const { rows } = await c.query(
        `select exists (select 1 from public.sends where inbox_id = $1 and sent_at >= ${LOCAL_DAY_START}) sent`,
        [inbox.id, since, tz],
      );
      ({ warmupDay, updatedOn: warmupOn } = advanceWarmup({ warmupDay, updatedOn: inbox.warmup_updated_on }, today, rows[0].sent));
    }

    // Step back on bounces or script errors.
    const { rows: stats } = await c.query(
      `select count(*) filter (where sent_at >= ${LOCAL_DAY_START})::int sent_today,
              count(*) filter (where sent_at > $4::timestamptz - interval '7 days')::int sent_7d,
              count(*) filter (where status = 'bounced' and sent_at > $4::timestamptz - interval '7 days')::int bounced_7d
         from public.sends where inbox_id = $1 and sent_at is not null`,
      [inbox.id, today, tz, now],
    );
    const { sent_today, sent_7d, bounced_7d } = stats[0];
    const back = stepBack({ warmupDay, stepBackOn: inbox.step_back_on }, today, {
      sent: sent_7d,
      bounced: bounced_7d,
      errorsToday: inbox.errors_on === today ? inbox.errors_today : 0,
    });
    if (back) warmupDay = back.warmupDay;

    await c.query(
      `update public.inboxes
          set last_heartbeat_at = $2, script_version = $3, warmup_day = $4, warmup_updated_on = $5::date,
              step_back_on = case when $6::text is null then step_back_on else $7::date end,
              last_error = coalesce($6, last_error)
        where id = $1`,
      [inbox.id, now, opts.scriptVersion, warmupDay, warmupOn, back ? `Warm-up stepped back: ${back.reason}` : null, today],
    );

    const decision = mayHandOut(
      {
        window: inbox.window,
        dailyCap: inbox.daily_cap,
        warmupDay,
        paused: inbox.health === "paused",
        nextSendAt: inbox.next_send_at,
        senderDisabled: inbox.sender_disabled,
      },
      sent_today,
      now,
    );

    let email: NextResponse["email"] = null;
    let reason: WaitReason | null = outdated ? "paused" : decision.ok ? null : decision.reason;
    if (!reason) {
      // One email at a time: wait while a handed-out email hasn't been reported (until its lease runs out).
      const { rows: out } = await c.query(
        `select 1 from public.sends where inbox_id = $1 and status = 'queued' and handed_out_at > $2::timestamptz - make_interval(secs => $3) limit 1`,
        [inbox.id, now, LEASE_MS / 1000],
      );
      if (out.length) reason = "too_soon";
    }
    if (!reason) {
      // Leads that got suppressed after their email was queued never go out.
      await c.query(
        `update public.sends s set status = 'stopped', status_detail = 'On the suppression list'
          where s.inbox_id = $1 and s.status = 'queued'
            and exists (select 1 from public.suppression x where x.workspace_id = s.workspace_id
                         and (lower(x.email) = lower(s.to_email) or x.domain = split_part(lower(s.to_email), '@', 2)))`,
        [inbox.id],
      );
      const { rows } = await c.query(
        `select s.id, s.to_email, s.subject, s.body, s.gmail_thread_id
           from public.sends s join public.campaigns c on c.id = s.campaign_id
          where s.inbox_id = $1 and s.status = 'queued' and c.send_state = 'sending'
            and (s.handed_out_at is null or s.handed_out_at < $2::timestamptz - make_interval(secs => $3))
          order by s.step_no, s.created_at
          limit 1
          for update of s skip locked`,
        [inbox.id, now, LEASE_MS / 1000],
      );
      if (rows[0]) {
        await c.query("update public.sends set handed_out_at = $2 where id = $1", [rows[0].id, now]);
        email = { send_id: rows[0].id, to: rows[0].to_email, subject: rows[0].subject, body: rows[0].body, thread_id: rows[0].gmail_thread_id };
      } else reason = "nothing_queued";
    }

    // Threads to check for replies and bounces: a rotating slice, oldest check first.
    const { rows: watch } = await c.query(
      `update public.sends set watch_checked_at = $2
        where id in (select id from public.sends
                      where inbox_id = $1 and status = 'sent' and gmail_thread_id is not null
                        and sent_at > $2::timestamptz - make_interval(days => $3)
                      order by watch_checked_at nulls first, sent_at
                      limit $4)
        returning id, gmail_thread_id`,
      [inbox.id, now, WATCH_DAYS, WATCH_PER_RUN],
    );

    return {
      email,
      wait: reason ? { reason, label: outdated ? "Please update the FirstLine script (see the Log)" : WAIT_LABEL[reason] } : null,
      watch: watch.map((w) => ({ send_id: w.id, thread_id: w.gmail_thread_id })),
      rules: { unsubscribe: UNSUBSCRIBE_PATTERN, reply_cut: REPLY_CUT_PATTERN, bounce_from: BOUNCE_SENDER_PATTERN },
      script: { latest: SENDER_SCRIPT_VERSION, update_required: outdated },
      inbox: { email: inbox.email, sent_today: sent_today, cap: decision.cap },
    };
  });
}

export type ReportBody = {
  send?: { send_id: string; status: "sent" | "failed"; thread_id?: string | null; error?: string | null };
  events?: { send_id: string; type: "replied" | "bounced"; unsubscribe?: boolean }[];
};

export type ReportResult = { sent: number; failed: number; replied: number; bounced: number; paused_same_domain: number };

/** POST /api/sender/report: what happened to a handed-out email, plus replies and bounces found in watched threads. */
export async function senderReport(pool: pg.Pool, key: string, body: ReportBody, opts: { now?: Date; random?: () => number } = {}): Promise<ReportResult> {
  const now = opts.now ?? new Date();
  return tx(pool, async (c) => {
    const inbox = await lockInbox(c, key);
    const today = localTime(now, inbox.window.tz).date;
    const out: ReportResult = { sent: 0, failed: 0, replied: 0, bounced: 0, paused_same_domain: 0 };

    if (body.send?.status === "sent") {
      const r = await c.query(
        `update public.sends set status = 'sent', sent_at = $3, gmail_thread_id = $4, handed_out_at = null
          where id = $1 and inbox_id = $2 and status = 'queued'`,
        [body.send.send_id, inbox.id, now, body.send.thread_id ?? null],
      );
      if (r.rowCount) {
        out.sent = 1;
        await c.query("update public.inboxes set next_send_at = $2 where id = $1", [inbox.id, new Date(now.getTime() + nextGapMs(opts.random))]);
      }
    } else if (body.send?.status === "failed") {
      const r = await c.query("update public.sends set handed_out_at = null where id = $1 and inbox_id = $2 and status = 'queued'", [body.send.send_id, inbox.id]);
      out.failed = r.rowCount ?? 0;
      await c.query(
        `update public.inboxes set errors_today = case when errors_on = $2::date then errors_today + 1 else 1 end,
                errors_on = $2::date, last_error = $3 where id = $1`,
        [inbox.id, today, `Send failed: ${(body.send.error ?? "unknown error").slice(0, 300)}`],
      );
    }

    for (const ev of body.events ?? []) {
      const status = ev.type === "bounced" ? "bounced" : "replied";
      const detail = ev.type === "bounced" ? "Bounced" : ev.unsubscribe ? "Asked to stop" : null;
      const { rows } = await c.query(
        `update public.sends set status = $3, status_detail = $4,
                replied_at = case when $3 = 'replied' then $5::timestamptz end,
                bounced_at = case when $3 = 'bounced' then $5::timestamptz end
          where id = $1 and inbox_id = $2 and status = 'sent'
          returning lead_id, workspace_id, lower(to_email) to_email`,
        [ev.send_id, inbox.id, status, detail, now],
      );
      const hit = rows[0];
      if (!hit) continue; // unknown or already handled: reports are idempotent
      if (status === "bounced") out.bounced++;
      else out.replied++;

      // Stop rules: never email this person again; later steps for this lead stop.
      await c.query(
        `insert into public.suppression (workspace_id, email, reason)
         select $1, $2, $3 where not exists (select 1 from public.suppression where workspace_id = $1 and lower(email) = $2)`,
        [hit.workspace_id, hit.to_email, status === "bounced" ? "bounce" : ev.unsubscribe ? "unsub" : "replied"],
      );
      await c.query(
        `update public.sends set status = 'stopped', status_detail = $2 where lead_id = $1 and status in ('queued', 'paused')`,
        [hit.lead_id, status === "bounced" ? "Earlier email bounced" : "Lead replied"],
      );

      // After a reply, pause (resumable) other leads at the same company domain. Never for gmail.com & co.
      if (status === "replied") {
        const { rows: lead } = await c.query("select domain from public.leads where id = $1", [hit.lead_id]);
        const domains = [...new Set([hit.to_email.split("@")[1], lead[0]?.domain].filter((d): d is string => !!d && !isFreeMailDomain(d)))];
        if (domains.length) {
          const p = await c.query(
            `update public.sends s set status = 'paused', status_detail = 'Colleague at ' || $3 || ' replied'
              where s.workspace_id = $1 and s.status = 'queued' and s.lead_id <> $2
                and (split_part(lower(s.to_email), '@', 2) = any($4::text[])
                     or exists (select 1 from public.leads l where l.id = s.lead_id and l.domain = any($4::text[])))`,
            [hit.workspace_id, hit.lead_id, domains[0], domains],
          );
          out.paused_same_domain += p.rowCount ?? 0;
        }
      }
    }
    return out;
  });
}

// ---- Called from the app (after the caller checked the user's workspace) -----------------

export async function createInbox(
  pool: pg.Pool,
  input: { workspaceId: string; email: string; window: SendWindow; dailyCap: number },
): Promise<{ id: string; key: string }> {
  const key = generateSenderKey();
  const { rows } = await pool.query(
    `insert into public.inboxes (workspace_id, email, daily_cap, "window", sender_key_hash, key_prefix)
     values ($1, lower($2), $3, $4, $5, $6) returning id`,
    [input.workspaceId, input.email.trim(), input.dailyCap, JSON.stringify(input.window), hashSenderKey(key), keyPrefix(key)],
  );
  return { id: rows[0].id, key };
}

/** A new key; the old one stops working at once. */
export async function rotateInboxKey(pool: pg.Pool, workspaceId: string, inboxId: string): Promise<string | null> {
  const key = generateSenderKey();
  const r = await pool.query("update public.inboxes set sender_key_hash = $3, key_prefix = $4 where id = $1 and workspace_id = $2", [
    inboxId,
    workspaceId,
    hashSenderKey(key),
    keyPrefix(key),
  ]);
  return r.rowCount ? key : null;
}

/** Queue step 1 for every finished lead (fallbacks only if the campaign sends them). Returns what happened. */
export async function startSending(
  pool: pg.Pool,
  input: { workspaceId: string; campaignId: string; inboxId: string; optOutLine: string | null },
): Promise<{ queued: number; suppressed: number; alreadyQueued: number; skippedFallbacks: number }> {
  return tx(pool, async (c) => {
    const { rows: camp } = await c.query(
      `select c.id, c.send_fallbacks from public.campaigns c
        join public.inboxes i on i.id = $3 and i.workspace_id = c.workspace_id
       where c.id = $1 and c.workspace_id = $2 for update of c`,
      [input.campaignId, input.workspaceId, input.inboxId],
    );
    if (!camp[0]) throw new Error("Campaign or inbox not found.");
    const sendFallbacks: boolean = camp[0].send_fallbacks;

    const { rows: leads } = await c.query(
      `select l.id, l.email, l.status, g.subject, g.full_email,
              exists (select 1 from public.sends s where s.lead_id = l.id and s.step_no = 1) already,
              exists (select 1 from public.suppression x where x.workspace_id = l.workspace_id
                       and (lower(x.email) = lower(l.email) or x.domain = split_part(lower(l.email), '@', 2))) suppressed
         from public.leads l
         join lateral (select subject, full_email from public.generations g
                        where g.lead_id = l.id and g.full_email is not null order by g.created_at desc limit 1) g on true
        where l.campaign_id = $1 and l.status in ('done', 'fallback')
        order by l.created_at, l.id`,
      [input.campaignId],
    );
    let queued = 0;
    let suppressed = 0;
    let alreadyQueued = 0;
    let skippedFallbacks = 0;
    for (const l of leads) {
      if (l.already) {
        alreadyQueued++;
        continue;
      }
      if (l.status === "fallback" && !sendFallbacks) {
        skippedFallbacks++;
        continue;
      }
      await c.query(
        // clock_timestamp(), not now(): keeps the import order inside this one transaction.
        `insert into public.sends (lead_id, workspace_id, campaign_id, step_no, inbox_id, to_email, subject, body, status, status_detail, created_at)
         values ($1, $2, $3, 1, $4, $5, $6, $7, $8, $9, clock_timestamp())`,
        [
          l.id,
          input.workspaceId,
          input.campaignId,
          input.inboxId,
          l.email,
          l.subject,
          composeBody(l.full_email, input.optOutLine),
          l.suppressed ? "stopped" : "queued",
          l.suppressed ? "On the suppression list" : null,
        ],
      );
      if (l.suppressed) suppressed++;
      else queued++;
    }
    await c.query("update public.campaigns set inbox_id = $2, opt_out_line = $3, send_state = 'sending' where id = $1", [
      input.campaignId,
      input.inboxId,
      input.optOutLine,
    ]);
    return { queued, suppressed, alreadyQueued, skippedFallbacks };
  });
}

export async function setCampaignSendState(pool: pg.Pool, workspaceId: string, campaignId: string, state: "sending" | "paused") {
  await pool.query("update public.campaigns set send_state = $3 where id = $1 and workspace_id = $2 and send_state is not null", [
    campaignId,
    workspaceId,
    state,
  ]);
}

export async function setInboxPaused(pool: pg.Pool, workspaceId: string, inboxId: string, paused: boolean) {
  await pool.query(
    `update public.inboxes set health = case when $3 then 'paused' else 'warming' end where id = $1 and workspace_id = $2`,
    [inboxId, workspaceId, paused],
  );
}

/** Resume a lead that was paused because a colleague replied. */
export async function resumeSend(pool: pg.Pool, workspaceId: string, sendId: string): Promise<boolean> {
  const r = await pool.query(
    "update public.sends set status = 'queued', status_detail = null, handed_out_at = null where id = $1 and workspace_id = $2 and status = 'paused'",
    [sendId, workspaceId],
  );
  return (r.rowCount ?? 0) > 0;
}
