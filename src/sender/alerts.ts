// Inbox health alerts (§8: "Inbox offline (no heartbeat 2h inside window) → mark offline + email the user").
// Run by the worker every few minutes. One email per outage; cleared when the heartbeat comes back.
import type pg from "pg";
import { inboxHealth, type SendWindow } from "@/lib/sender/schedule";

export type AlertEmail = { to: string; subject: string; text: string };
export interface Mailer {
  send(msg: AlertEmail): Promise<void>;
}

/** Resend's REST API (resend.com). `from` must be a verified sender; onboarding@resend.dev only reaches the account owner. */
export function resendMailer(apiKey: string, from: string, fetchImpl: typeof fetch = fetch): Mailer {
  return {
    async send(msg) {
      const ctrl = new AbortController();
      const t = setTimeout(() => ctrl.abort(), 15_000);
      try {
        const res = await fetchImpl("https://api.resend.com/emails", {
          method: "POST",
          headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
          body: JSON.stringify({ from, to: [msg.to], subject: msg.subject, text: msg.text }),
          signal: ctrl.signal,
        });
        if (!res.ok) throw new Error(`Resend ${res.status}: ${(await res.text().catch(() => "")).slice(0, 200)}`);
      } finally {
        clearTimeout(t);
      }
    },
  };
}

export function offlineEmail(inboxEmail: string, lastSeen: Date, appUrl: string | null): Omit<AlertEmail, "to"> {
  return {
    subject: `FirstLine: ${inboxEmail} is offline`,
    text: [
      `Your FirstLine inbox ${inboxEmail} hasn't checked in for over 2 hours during its sending window (last seen ${lastSeen.toUTCString()}).`,
      "",
      "Nothing is sent from this inbox until its Sender Sheet runs again. Things to check:",
      "- the spreadsheet with the FirstLine script still exists in that Google account;",
      "- in the sheet, FirstLine → Connect… (this reinstalls the 5-minute trigger);",
      "- Google didn't ask to approve the script's permissions again.",
      "",
      appUrl ? `Inbox status: ${appUrl}/inboxes` : "You can see the inbox status under Inboxes in FirstLine.",
    ].join("\n"),
  };
}

/**
 * Email the owner about inboxes that went offline (once per outage) and clear the flag on inboxes
 * that came back. Without a mailer it still records the outage, so nothing piles up later.
 */
export async function checkInboxHealth(
  pool: pg.Pool,
  mailer: Mailer | null,
  opts: { now?: Date; appUrl?: string | null; log?: (msg: string) => void } = {},
): Promise<{ alerted: string[]; recovered: number; failed: string[] }> {
  const now = opts.now ?? new Date();
  const recovered = await pool.query(
    "update public.inboxes set offline_alerted_at = null where offline_alerted_at is not null and last_heartbeat_at > offline_alerted_at",
  );
  const { rows } = await pool.query(
    `select i.id, i.email, i."window", i.daily_cap, i.warmup_day, i.health, i.last_heartbeat_at, u.email owner_email
       from public.inboxes i
       join public.workspaces w on w.id = i.workspace_id
       left join auth.users u on u.id = w.owner_id
      where i.last_heartbeat_at is not null and i.offline_alerted_at is null and i.health <> 'paused'`,
  );
  const alerted: string[] = [];
  const failed: string[] = [];
  for (const r of rows) {
    const health = inboxHealth(
      { window: r.window as SendWindow, dailyCap: r.daily_cap, warmupDay: r.warmup_day, paused: false, lastHeartbeatAt: r.last_heartbeat_at },
      now,
    );
    if (health !== "offline") continue;
    try {
      if (mailer && r.owner_email) await mailer.send({ to: r.owner_email, ...offlineEmail(r.email, r.last_heartbeat_at, opts.appUrl ?? null) });
      else opts.log?.(`Inbox ${r.email} is offline (no alert email: ${mailer ? "owner has no email" : "RESEND_API_KEY not set"}).`);
      await pool.query("update public.inboxes set offline_alerted_at = $2 where id = $1", [r.id, now]);
      alerted.push(r.email);
    } catch (e) {
      failed.push(r.email);
      opts.log?.(`Couldn't email about offline inbox ${r.email}: ${(e as Error).message}`);
    }
  }
  return { alerted, recovered: recovered.rowCount ?? 0, failed };
}
