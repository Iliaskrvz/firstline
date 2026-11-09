// Sender scheduler (§8). Pure: the server decides when an inbox may send; the
// Apps Script only asks "anything for me now?" every 5 minutes.

export type SendWindow = {
  /** ISO weekdays: 1 = Monday … 7 = Sunday. */
  days: number[];
  start: string; // "08:30"
  end: string; // "17:00"
  tz: string; // IANA, e.g. "Europe/Amsterdam"
};

export const DEFAULT_WINDOW: SendWindow = { days: [1, 2, 3, 4, 5], start: "08:30", end: "17:00", tz: "Europe/Amsterdam" };

export const WARMUP_START = 10;
export const WARMUP_STEP = 2;
export const GAP_MIN_MS = 6 * 60_000;
export const GAP_MAX_MS = 14 * 60_000;
export const BOUNCE_STEP_BACK_RATE = 0.03;
export const BOUNCE_MIN_SENDS = 20;
export const STEP_BACK_DAYS = 3;
export const ERRORS_BEFORE_STEP_BACK = 3;
/** A handed-out email that the script never reported can be handed out again after this. */
export const LEASE_MS = 30 * 60_000;
/** No heartbeat for this long inside the window → offline (§8). */
export const OFFLINE_AFTER_MS = 2 * 60 * 60_000;

const WEEKDAY: Record<string, number> = { Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6, Sun: 7 };

export type LocalTime = { date: string; weekday: number; minutes: number };

/** Wall-clock date, ISO weekday and minutes since midnight in a timezone. */
export function localTime(now: Date, tz: string): LocalTime {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat("en-US", {
      timeZone: tz,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      weekday: "short",
      hour: "2-digit",
      minute: "2-digit",
      hourCycle: "h23",
    })
      .formatToParts(now)
      .map((p) => [p.type, p.value]),
  );
  return {
    date: `${parts.year}-${parts.month}-${parts.day}`,
    weekday: WEEKDAY[parts.weekday],
    minutes: Number(parts.hour) * 60 + Number(parts.minute),
  };
}

export function isValidTimeZone(tz: string): boolean {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

function toMinutes(hhmm: string): number {
  const m = /^(\d{1,2}):(\d{2})$/.exec(hhmm.trim());
  if (!m) return NaN;
  return Number(m[1]) * 60 + Number(m[2]);
}

export function validateWindow(w: SendWindow): string | null {
  if (!w.days.length || w.days.some((d) => !Number.isInteger(d) || d < 1 || d > 7)) return "Pick at least one sending day.";
  const s = toMinutes(w.start);
  const e = toMinutes(w.end);
  if (!(s >= 0 && s < 24 * 60) || !(e > 0 && e <= 24 * 60)) return "Use times like 08:30.";
  if (e <= s) return "The end time must be after the start time.";
  if (!isValidTimeZone(w.tz)) return "Unknown timezone.";
  return null;
}

export function inWindow(w: SendWindow, now: Date): boolean {
  const t = localTime(now, w.tz);
  return w.days.includes(t.weekday) && t.minutes >= toMinutes(w.start) && t.minutes < toMinutes(w.end);
}

/** Today's limit: warm-up 10 → 30 at +2 per sending day (§8), never above the inbox cap. */
export function effectiveCap(dailyCap: number, warmupDay: number): number {
  return Math.max(1, Math.min(dailyCap, WARMUP_START + WARMUP_STEP * Math.max(0, warmupDay)));
}

/**
 * Warm-up moves one step per sending day: the first time an inbox asks for
 * work on a new local date (inside its window), if it sent anything since the
 * last step. Returns the new warm-up day and the date to remember.
 */
export function advanceWarmup(
  state: { warmupDay: number; updatedOn: string | null },
  today: string,
  sentSinceLastStep: boolean,
): { warmupDay: number; updatedOn: string } {
  if (state.updatedOn === null) return { warmupDay: state.warmupDay, updatedOn: today };
  // Same day, or a clock that went backwards (ISO dates compare as strings): no step, keep the later date.
  if (today <= state.updatedOn) return { warmupDay: state.warmupDay, updatedOn: state.updatedOn };
  return { warmupDay: state.warmupDay + (sentSinceLastStep ? 1 : 0), updatedOn: today };
}

/** Bounces above 3 % (over at least 20 recent sends) or repeated script errors → step back the warm-up, once a day. */
export function stepBack(
  state: { warmupDay: number; stepBackOn: string | null },
  today: string,
  signal: { sent: number; bounced: number; errorsToday: number },
): { warmupDay: number; reason: string } | null {
  if (state.stepBackOn === today) return null;
  const bounceRate = signal.sent >= BOUNCE_MIN_SENDS ? signal.bounced / signal.sent : 0;
  const reason =
    bounceRate > BOUNCE_STEP_BACK_RATE
      ? `Bounce rate ${(bounceRate * 100).toFixed(1)} % over the last ${signal.sent} emails`
      : signal.errorsToday >= ERRORS_BEFORE_STEP_BACK
        ? `${signal.errorsToday} script errors today`
        : null;
  if (!reason) return null;
  return { warmupDay: Math.max(0, state.warmupDay - STEP_BACK_DAYS), reason };
}

/** Random 6–14 minute gap between two emails from one inbox. */
export function nextGapMs(random: () => number = Math.random): number {
  return Math.round(GAP_MIN_MS + (GAP_MAX_MS - GAP_MIN_MS) * random());
}

export type WaitReason = "sender_disabled" | "paused" | "outside_window" | "daily_cap" | "too_soon" | "nothing_queued";

export const WAIT_LABEL: Record<WaitReason, string> = {
  sender_disabled: "Sending is disabled for this workspace",
  paused: "Inbox paused",
  outside_window: "Outside the sending window",
  daily_cap: "Today's limit reached",
  too_soon: "Waiting for the gap between emails",
  nothing_queued: "Nothing to send",
};

/** May this inbox send right now? (Whether something is queued is checked after.) */
export function mayHandOut(
  inbox: { window: SendWindow; dailyCap: number; warmupDay: number; paused: boolean; nextSendAt: Date | null; senderDisabled: boolean },
  sentToday: number,
  now: Date,
): { ok: true; cap: number } | { ok: false; reason: WaitReason; cap: number } {
  const cap = effectiveCap(inbox.dailyCap, inbox.warmupDay);
  if (inbox.senderDisabled) return { ok: false, reason: "sender_disabled", cap };
  if (inbox.paused) return { ok: false, reason: "paused", cap };
  if (!inWindow(inbox.window, now)) return { ok: false, reason: "outside_window", cap };
  if (sentToday >= cap) return { ok: false, reason: "daily_cap", cap };
  if (inbox.nextSendAt && inbox.nextSendAt.getTime() > now.getTime()) return { ok: false, reason: "too_soon", cap };
  return { ok: true, cap };
}

export type InboxHealth = "not_connected" | "paused" | "offline" | "warming" | "healthy";

/** What the Inboxes screen shows. Offline only counts inside the window (a script sleeping at night is fine). */
export function inboxHealth(
  inbox: { window: SendWindow; dailyCap: number; warmupDay: number; paused: boolean; lastHeartbeatAt: Date | null },
  now: Date,
): InboxHealth {
  if (inbox.paused) return "paused";
  if (!inbox.lastHeartbeatAt) return "not_connected";
  if (inWindow(inbox.window, now) && now.getTime() - inbox.lastHeartbeatAt.getTime() > OFFLINE_AFTER_MS) return "offline";
  return effectiveCap(inbox.dailyCap, inbox.warmupDay) < inbox.dailyCap ? "warming" : "healthy";
}
