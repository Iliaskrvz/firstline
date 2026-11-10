// Follow-up steps (§8, §10.7). Pure: validation, plain-step rendering, working-day scheduling.
import { hasErrors, parseTemplate, render } from "@/lib/template";
import { localTime } from "./schedule";

export const MAX_FOLLOW_UPS = 4;
export const MAX_DELAY_DAYS = 30;

export type FollowUpStep = { step_no: number; delay_days: number; kind: "plain" | "personalised"; template_body: string };

/** Problems with one follow-up step, in plain words. Empty = fine. */
export function validateStep(step: Pick<FollowUpStep, "delay_days" | "kind" | "template_body">, availableVariables: string[]): string[] {
  const out: string[] = [];
  if (!Number.isInteger(step.delay_days) || step.delay_days < 0 || step.delay_days > MAX_DELAY_DAYS) {
    out.push(`Wait between 0 and ${MAX_DELAY_DAYS} working days.`);
  }
  if (!step.template_body.trim()) {
    out.push("Write the follow-up text.");
    return out;
  }
  const parsed = parseTemplate({ subject: "", body: step.template_body }, { availableVariables });
  out.push(...parsed.issues.filter((i) => i.level === "error").map((i) => i.message));
  if (step.kind === "plain" && parsed.slots.length > 0) out.push("A plain follow-up can't have [[slots]]. Make it personalised, or remove the slots.");
  if (step.kind === "personalised" && parsed.slots.length === 0) out.push("A personalised follow-up needs at least one [[slot]].");
  return out;
}

/** A plain follow-up for one lead: only {{variables}} are filled in. */
export function renderPlainStep(body: string, vars: Record<string, string | null | undefined>): string {
  const parsed = parseTemplate({ subject: "", body });
  if (hasErrors(parsed) || parsed.slots.length) throw new Error("Not a valid plain follow-up.");
  return render(parsed.body, vars).replace(/[ \t]+\n/g, "\n").replace(/\n{3,}/g, "\n\n").trim();
}

/** Same thread: the follow-up shows as a reply ("Re: …"). */
export function followUpSubject(firstSubject: string): string {
  return /^re:/i.test(firstSubject.trim()) ? firstSubject.trim() : `Re: ${firstSubject.trim()}`;
}

/** The instant a wall-clock time in a timezone happens (good to the minute; DST gaps resolve forward). */
export function zonedTime(date: string, hhmm: string, tz: string): Date {
  const [y, m, d] = date.split("-").map(Number);
  const [h, min] = hhmm.split(":").map(Number);
  const guess = Date.UTC(y, m - 1, d, h, min);
  const seen = localTime(new Date(guess), tz);
  const [sy, sm, sd] = seen.date.split("-").map(Number);
  const offset = Date.UTC(sy, sm - 1, sd, 0, seen.minutes) - guess;
  return new Date(guess - offset);
}

/**
 * When a follow-up is due: `days` working days (Mon–Fri) after the previous step was sent, from the
 * start of that day in the inbox's timezone. 0 = right away (the sending window and gap still apply).
 */
export function addWorkingDays(sentAt: Date, days: number, tz: string): Date {
  if (days <= 0) return sentAt;
  let { date, weekday } = localTime(sentAt, tz);
  let left = days;
  while (left > 0) {
    const [y, m, d] = date.split("-").map(Number);
    const next = new Date(Date.UTC(y, m - 1, d + 1));
    date = next.toISOString().slice(0, 10);
    weekday = weekday === 7 ? 1 : weekday + 1;
    if (weekday <= 5) left--;
  }
  return zonedTime(date, "00:00", tz);
}
