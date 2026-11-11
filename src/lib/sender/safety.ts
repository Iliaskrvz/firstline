// Gmail safety tips for onboarding (§8): which warnings apply to one inbox.
import { isFreeMailDomain } from "@/lib/domain";

/** Apps Script recipient limits per day (§8). */
export const GMAIL_FREE_DAILY_LIMIT = 100;
export const WORKSPACE_DAILY_LIMIT = 1500;
/** Above this per inbox, spread over more inboxes instead. */
export const SAFE_DAILY_PER_INBOX = 50;

const domainOf = (email: string | null | undefined) => email?.split("@")[1]?.trim().toLowerCase() || null;

export function isFreeGmail(email: string | null | undefined): boolean {
  const d = domainOf(email);
  return d === "gmail.com" || d === "googlemail.com";
}

export type InboxWarning = { id: "free_gmail" | "over_gmail_limit" | "main_domain" | "high_cap"; text: string };

export function inboxWarnings(i: { email: string; dailyCap: number }, accountEmail: string | null): InboxWarning[] {
  const out: InboxWarning[] = [];
  const free = isFreeGmail(i.email);
  if (free) {
    out.push({ id: "free_gmail", text: `Free Gmail can send to at most ${GMAIL_FREE_DAILY_LIMIT} people a day through a script and gets flagged sooner. A Google Workspace inbox is safer for outreach.` });
    if (i.dailyCap > GMAIL_FREE_DAILY_LIMIT) out.push({ id: "over_gmail_limit", text: `The daily limit is above Gmail's ${GMAIL_FREE_DAILY_LIMIT} a day: Google will block sends after that.` });
  }
  const inboxDomain = domainOf(i.email);
  const mainDomain = domainOf(accountEmail);
  if (!free && inboxDomain && inboxDomain === mainDomain && !isFreeMailDomain(mainDomain)) {
    out.push({ id: "main_domain", text: `This inbox is on ${inboxDomain}, your main domain. Spam complaints there also hurt your normal email. Use a separate domain for cold outreach (for example get${inboxDomain}).` });
  }
  if (i.dailyCap > SAFE_DAILY_PER_INBOX && !(free && i.dailyCap > GMAIL_FREE_DAILY_LIMIT)) {
    out.push({ id: "high_cap", text: `More than ${SAFE_DAILY_PER_INBOX} emails a day from one inbox raises the spam risk. Add another inbox instead of raising the limit.` });
  }
  return out;
}
