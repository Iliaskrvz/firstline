// The Outlook / Microsoft 365 sending lane (Phase O2), run by the worker. It drives each connected
// inbox through the same scheduler as the Gmail lane (senderNext / senderReport in db.ts: caps, warm-up,
// random gaps, send window, rotation, suppression, opt-out line, stop rules); only the transport is
// Microsoft Graph instead of the Sender Sheet. Never throws out of the tick: a broken inbox is marked
// and skipped, never the worker.
import type pg from "pg";
import { HttpError, isRetryable, withRetry } from "@/engine/retry";
import type { SendWindow } from "@/lib/sender/schedule";
import { decryptSecret, encryptSecret } from "@/lib/secret-box";
import type { Mailer } from "./alerts";
import { senderNext, senderRelease, senderReport, SENDER_SCRIPT_VERSION, WATCH_DAYS } from "./db";
import { classifyInboxMessage, findSent, MicrosoftAuthError, missingScopes, type GraphMail, type InboxEvent, type MicrosoftAuth, type TokenSet, type Tracked } from "./microsoft";

export const REPLY_CHECK_MS = 10 * 60_000;

export type OutlookDeps = {
  pool: pg.Pool;
  /** INTEGRATIONS_ENCRYPTION_KEY (32 bytes). */
  key: Buffer;
  auth: MicrosoftAuth;
  graph: (accessToken: string) => GraphMail;
  now?: () => Date;
  sleep?: (ms: number) => Promise<void>;
  log?: (...a: unknown[]) => void;
};

const nowOf = (d: OutlookDeps) => d.now?.() ?? new Date();

// ---- Connecting ---------------------------------------------------------------------------------

/**
 * After sign-in: create the inbox (or switch an existing address to Outlook) and store the tokens,
 * encrypted. Refuses when Microsoft didn't grant what sending needs.
 */
export async function connectOutlookInbox(
  pool: pg.Pool,
  key: Buffer,
  input: { workspaceId: string; email: string; tokens: TokenSet; window?: SendWindow; dailyCap?: number },
): Promise<{ inboxId: string; updated: boolean }> {
  const missing = missingScopes(input.tokens.scope);
  if (missing.length) throw new Error(`Microsoft didn't grant ${missing.join(" and ")}.`);
  if (!input.tokens.tenantId || !input.tokens.accountId) throw new Error("Microsoft didn't say which organisation this account belongs to.");
  const c = await pool.connect();
  try {
    await c.query("begin");
    const { rows } = await c.query(
      `insert into public.inboxes (workspace_id, email, type, daily_cap, "window", health)
       values ($1, lower($2), 'outlook_oauth', $3, coalesce($4::jsonb, '{"days": [1, 2, 3, 4, 5], "start": "08:30", "end": "17:00", "tz": "Europe/Amsterdam"}'::jsonb), 'warming')
       on conflict (workspace_id, email) do update
         set type = 'outlook_oauth', sender_key_hash = null, key_prefix = null, last_error = null,
             health = case when public.inboxes.health in ('disconnected', 'offline') then 'warming' else public.inboxes.health end
       returning id, (xmax <> 0) updated`,
      [input.workspaceId, input.email.trim(), input.dailyCap ?? 30, input.window ? JSON.stringify(input.window) : null],
    );
    const inboxId: string = rows[0].id;
    await c.query(
      `insert into public.inbox_credentials (inbox_id, workspace_id, provider, tenant_id, account_id, scopes, refresh_token_enc, access_token_enc, access_expires_at)
       values ($1, $2, 'microsoft', $3, $4, $5, $6, $7, $8)
       on conflict (inbox_id) do update
         set tenant_id = excluded.tenant_id, account_id = excluded.account_id, scopes = excluded.scopes,
             refresh_token_enc = excluded.refresh_token_enc, access_token_enc = excluded.access_token_enc,
             access_expires_at = excluded.access_expires_at, connected_at = now(),
             disconnected_at = null, disconnect_reason = null, disconnect_alerted_at = null`,
      [inboxId, input.workspaceId, input.tokens.tenantId, input.tokens.accountId, input.tokens.scope, encryptSecret(input.tokens.refreshToken, key), encryptSecret(input.tokens.accessToken, key), input.tokens.expiresAt],
    );
    await c.query("commit");
    return { inboxId, updated: rows[0].updated };
  } catch (e) {
    await c.query("rollback").catch(() => {});
    throw e;
  } finally {
    c.release();
  }
}

/** The user disconnects the inbox in FirstLine: the tokens are deleted at once; queued emails wait. */
export async function disconnectOutlookInbox(pool: pg.Pool, workspaceId: string, inboxId: string): Promise<boolean> {
  const r = await pool.query("delete from public.inbox_credentials where inbox_id = $1 and workspace_id = $2", [inboxId, workspaceId]);
  if (!r.rowCount) return false;
  await pool.query("update public.inboxes set health = 'disconnected', last_error = 'Disconnected in FirstLine. Connect it again to continue sending.' where id = $1 and workspace_id = $2", [inboxId, workspaceId]);
  return true;
}

/** The connection is gone (revoked, admin password reset, 90 days unused, consent withdrawn). */
export async function markDisconnected(pool: pg.Pool, inboxId: string, reason: string, at: Date = new Date()) {
  await pool.query(
    `update public.inbox_credentials set refresh_token_enc = null, access_token_enc = null, access_expires_at = null,
            disconnected_at = coalesce(disconnected_at, $2), disconnect_reason = $3 where inbox_id = $1`,
    [inboxId, at, reason.slice(0, 300)],
  );
  await pool.query(
    "update public.inboxes set health = 'disconnected', last_error = $2 where id = $1",
    [inboxId, "Microsoft 365 disconnected: connect this inbox again on the Inboxes page. Sending is paused until then."],
  );
}

type CredRow = { inbox_id: string; workspace_id: string; email: string; refresh_token_enc: string | null; access_token_enc: string | null; access_expires_at: Date | null; delta_link_enc: string | null; checked_at: Date | null; connected_at: Date };

/** A valid access token, refreshed when it's about to expire (refresh tokens rotate: the new one is stored). */
async function accessToken(d: OutlookDeps, row: CredRow, force = false): Promise<string | null> {
  if (!row.refresh_token_enc) return null;
  const now = nowOf(d);
  if (!force && row.access_token_enc && row.access_expires_at && row.access_expires_at.getTime() - now.getTime() > 120_000) {
    return decryptSecret(row.access_token_enc, d.key);
  }
  try {
    const t = await d.auth.refresh(decryptSecret(row.refresh_token_enc, d.key));
    const missing = missingScopes(t.scope);
    if (missing.length) {
      await markDisconnected(d.pool, row.inbox_id, `Permission withdrawn: ${missing.join(", ")}`, now);
      return null;
    }
    await d.pool.query(
      "update public.inbox_credentials set refresh_token_enc = $2, access_token_enc = $3, access_expires_at = $4, scopes = $5 where inbox_id = $1",
      [row.inbox_id, encryptSecret(t.refreshToken, d.key), encryptSecret(t.accessToken, d.key), t.expiresAt, t.scope],
    );
    row.refresh_token_enc = encryptSecret(t.refreshToken, d.key);
    return t.accessToken;
  } catch (e) {
    if (e instanceof MicrosoftAuthError && e.kind === "disconnected") {
      await markDisconnected(d.pool, row.inbox_id, e.message, now);
      d.log?.(`outlook ${row.email}: disconnected (${e.code ?? "no code"})`);
      return null;
    }
    d.log?.(`outlook ${row.email}: token refresh failed, trying again later:`, (e as Error).message);
    return null;
  }
}

// ---- Sending ------------------------------------------------------------------------------------

export type SendOutcome = "sent" | "waiting" | "throttled" | "failed" | "disconnected";

async function lookUpSent(d: OutlookDeps, g: GraphMail, want: Parameters<typeof findSent>[1]) {
  // Sent Items can lag a moment behind sendMail's 202.
  for (let i = 0; i < 4; i++) {
    const hit = findSent(await g.recentSent(20), want);
    if (hit) return hit;
    await (d.sleep ?? ((ms) => new Promise((r) => setTimeout(r, ms))))(1500 * (i + 1));
  }
  return null;
}

/** At most one email for this inbox, if the scheduler says one is due. */
export async function sendNextOutlook(d: OutlookDeps, row: CredRow): Promise<SendOutcome> {
  const token = await accessToken(d, row);
  if (!token) return "disconnected";
  const next = await senderNext(d.pool, { inboxId: row.inbox_id }, { scriptVersion: SENDER_SCRIPT_VERSION, now: nowOf(d) });
  const email = next.email;
  if (!email) return "waiting";
  const g = d.graph(token);
  const started = nowOf(d);
  try {
    // Idempotent: if an earlier run sent this but couldn't report it, report it now instead of sending twice.
    const earlier = (await g.recentSent(20)).find((s) => s.sendId === email.send_id);
    if (!earlier) {
      const retry = { retries: 2, baseMs: 1000, maxMs: 10_000, sleep: d.sleep };
      if (email.reply_to_message_id) await withRetry(() => g.reply(email.reply_to_message_id!, { to: email.to, text: email.body, sendId: email.send_id }), retry);
      // A follow-up whose first email can't be found goes out as a new email with the "Re:" subject.
      else await withRetry(() => g.sendMail({ to: email.to, subject: email.subject, text: email.body, sendId: email.send_id }), retry);
    }
    const sent = earlier ?? (await lookUpSent(d, g, { sendId: email.send_id, to: email.to, subject: email.subject, after: started }));
    if (!sent) d.log?.(`outlook ${row.email}: sent ${email.send_id} but couldn't find it in Sent Items; replies to it can't be tracked`);
    await senderReport(d.pool, { inboxId: row.inbox_id }, { send: { send_id: email.send_id, status: "sent", thread_id: sent?.conversationId ?? null, message_id: sent?.id ?? null } }, { now: nowOf(d) });
    return "sent";
  } catch (e) {
    if (e instanceof HttpError && e.status === 401) {
      await senderRelease(d.pool, row.inbox_id, email.send_id, null);
      return (await accessToken(d, row, true)) ? "failed" : "disconnected";
    }
    if (e instanceof HttpError && (e.status === 429 || e.status === 503)) {
      await senderRelease(d.pool, row.inbox_id, email.send_id, new Date(nowOf(d).getTime() + Math.max(e.retryAfterMs ?? 60_000, 30_000)));
      d.log?.(`outlook ${row.email}: Microsoft is throttling, trying again later`);
      return "throttled";
    }
    if (isRetryable(e)) {
      await senderRelease(d.pool, row.inbox_id, email.send_id, new Date(nowOf(d).getTime() + 60_000));
      return "throttled";
    }
    // A real refusal (e.g. an invalid address): counted, like a failed send from the Gmail sheet.
    await senderReport(d.pool, { inboxId: row.inbox_id }, { send: { send_id: email.send_id, status: "failed", error: (e as Error).message } }, { now: nowOf(d) });
    return "failed";
  }
}

// ---- Replies and bounces ------------------------------------------------------------------------

/** Every ~10 minutes: new Inbox messages (properties only) checked against this inbox's tracked conversations. */
export async function checkOutlookReplies(d: OutlookDeps, row: CredRow): Promise<{ replied: number; bounced: number } | null> {
  const now = nowOf(d);
  if (row.checked_at && now.getTime() - row.checked_at.getTime() < REPLY_CHECK_MS) return null;
  const { rows: tracked } = await d.pool.query<{ send_id: string; conversation_id: string; subject: string }>(
    `select s.id send_id, s.gmail_thread_id conversation_id, s.subject
       from public.sends s
      where s.inbox_id = $1 and s.status = 'sent' and s.gmail_thread_id is not null
        and s.sent_at > $2::timestamptz - make_interval(days => $3)
        and not exists (select 1 from public.sends x where x.lead_id = s.lead_id and x.status in ('replied', 'bounced'))
      order by s.sent_at`,
    [row.inbox_id, now, WATCH_DAYS],
  );
  if (!tracked.length) {
    await d.pool.query("update public.inbox_credentials set checked_at = $2 where inbox_id = $1", [row.inbox_id, now]);
    return { replied: 0, bounced: 0 };
  }
  const token = await accessToken(d, row);
  if (!token) return null;
  const g = d.graph(token);
  try {
    const delta = await withRetry(() => g.inboxDelta(row.delta_link_enc ? decryptSecret(row.delta_link_enc, d.key) : null, row.connected_at), { retries: 2, baseMs: 1000, sleep: d.sleep });
    const ctx = { inboxEmail: row.email, tracked: tracked.map((t): Tracked => ({ sendId: t.send_id, conversationId: t.conversation_id, subject: t.subject })) };
    const events = new Map<string, InboxEvent>();
    for (const m of delta.messages) {
      const ev = classifyInboxMessage(m, ctx);
      // A bounce beats a reply for the same email (the "reply" was the bounce's own conversation).
      if (ev && (!events.has(ev.send_id) || ev.type === "bounced")) events.set(ev.send_id, ev);
    }
    const r = events.size ? await senderReport(d.pool, { inboxId: row.inbox_id }, { events: [...events.values()] }, { now }) : { replied: 0, bounced: 0 };
    await d.pool.query("update public.inbox_credentials set delta_link_enc = $2, checked_at = $3 where inbox_id = $1", [row.inbox_id, encryptSecret(delta.deltaLink, d.key), now]);
    return { replied: r.replied, bounced: r.bounced };
  } catch (e) {
    if (e instanceof HttpError && e.status === 401) await accessToken(d, row, true);
    else d.log?.(`outlook ${row.email}: reply check failed, trying again later:`, (e as Error).message);
    return null;
  }
}

// ---- The worker tick ----------------------------------------------------------------------------

/** Every connected Outlook inbox: maybe one email, and the reply/bounce check when it's due. */
export async function outlookTick(d: OutlookDeps): Promise<{ inboxes: number; sent: number; disconnected: number }> {
  const { rows } = await d.pool.query<CredRow>(
    `select c.inbox_id, c.workspace_id, i.email, c.refresh_token_enc, c.access_token_enc, c.access_expires_at, c.delta_link_enc, c.checked_at, c.connected_at
       from public.inbox_credentials c join public.inboxes i on i.id = c.inbox_id
      where c.provider = 'microsoft' and c.disconnected_at is null and i.type = 'outlook_oauth'
      order by i.created_at`,
  );
  const out = { inboxes: rows.length, sent: 0, disconnected: 0 };
  for (const row of rows) {
    try {
      const r = await sendNextOutlook(d, row);
      if (r === "sent") out.sent++;
      if (r === "disconnected") {
        out.disconnected++;
        continue;
      }
      await checkOutlookReplies(d, row);
    } catch (e) {
      d.log?.(`outlook ${row.email}: skipped this round:`, (e as Error).message);
    }
  }
  return out;
}

/** One email per disconnection to the workspace owner, so a revoked inbox doesn't silently stop a campaign. */
export async function alertDisconnected(pool: pg.Pool, mailer: Mailer | null, appUrl: string | null, now = new Date()): Promise<string[]> {
  const { rows } = await pool.query(
    `select c.inbox_id, i.email inbox_email, u.email owner_email, c.disconnect_reason
       from public.inbox_credentials c join public.inboxes i on i.id = c.inbox_id
       join public.workspaces w on w.id = c.workspace_id left join auth.users u on u.id = w.owner_id
      where c.disconnected_at is not null and c.disconnect_alerted_at is null`,
  );
  const alerted: string[] = [];
  for (const r of rows) {
    if (mailer && r.owner_email) {
      try {
        await mailer.send({
          to: r.owner_email,
          subject: `FirstLine: ${r.inbox_email} is disconnected`,
          text: [
            `FirstLine can no longer send from ${r.inbox_email}: Microsoft 365 ended the connection.`,
            "This happens when an admin resets the password, access is revoked, or the inbox wasn't used for 90 days.",
            "",
            "Sending from this inbox is paused. Nothing is lost: connect it again and it continues where it stopped.",
            appUrl ? `Connect again: ${appUrl}/inboxes` : "Connect it again under Inboxes in FirstLine.",
          ].join("\n"),
        });
      } catch {
        continue; // try again next round
      }
    }
    await pool.query("update public.inbox_credentials set disconnect_alerted_at = $2 where inbox_id = $1", [r.inbox_id, now]);
    alerted.push(r.inbox_email);
  }
  return alerted;
}
