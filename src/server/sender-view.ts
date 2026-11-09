// Read models for the sending screens (server only). Not React components, so
// they may read the clock.
import "server-only";
import { readFileSync } from "node:fs";
import path from "node:path";
import { effectiveCap, inboxHealth, type InboxHealth, type SendWindow } from "@/lib/sender/schedule";
import { serverPool } from "./db";

export type InboxView = {
  id: string;
  email: string;
  dailyCap: number;
  cap: number;
  warmupDay: number;
  window: SendWindow;
  health: InboxHealth;
  sentToday: number;
  lastSeenSecondsAgo: number | null;
  keyPrefix: string | null;
  scriptVersion: string | null;
  lastError: string | null;
};

export async function loadInboxes(workspaceId: string): Promise<InboxView[]> {
  const { rows } = await serverPool().query(
    `select i.id, i.email, i.daily_cap, i.warmup_day, i."window", i.health, i.last_heartbeat_at, i.key_prefix, i.script_version, i.last_error,
            extract(epoch from now() - i.last_heartbeat_at)::int seconds_ago,
            (select count(*) from public.sends s where s.inbox_id = i.id
              and s.sent_at >= (date_trunc('day', now() at time zone (i."window"->>'tz')) at time zone (i."window"->>'tz')))::int sent_today
       from public.inboxes i where i.workspace_id = $1 order by i.created_at`,
    [workspaceId],
  );
  const now = new Date();
  return rows.map((r) => ({
    id: r.id,
    email: r.email,
    dailyCap: r.daily_cap,
    cap: effectiveCap(r.daily_cap, r.warmup_day),
    warmupDay: r.warmup_day,
    window: r.window,
    health: inboxHealth(
      { window: r.window, dailyCap: r.daily_cap, warmupDay: r.warmup_day, paused: r.health === "paused", lastHeartbeatAt: r.last_heartbeat_at },
      now,
    ),
    sentToday: r.sent_today,
    lastSeenSecondsAgo: r.seconds_ago,
    keyPrefix: r.key_prefix,
    scriptVersion: r.script_version,
    lastError: r.last_error,
  }));
}

/** The address the Apps Script calls. Google can't reach localhost, so in development this is the tunnel. */
export function publicAppUrl(): string | null {
  const v = process.env.PUBLIC_APP_URL?.trim().replace(/\/+$/, "");
  return v && /^https:\/\//.test(v) ? v : null;
}

let script: string | null = null;
/** The current Sender Sheet script, for the "Copy script" button. */
export function senderScript(): string {
  script ??= readFileSync(path.join(process.cwd(), "apps-script", "Code.gs"), "utf8");
  return script;
}
