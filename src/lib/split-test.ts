// Split test (owner's own outreach, 2026-11-27): half of a campaign's leads get the plain copy
// (holdout), half get FirstLine, from the same inboxes on the same schedule. Pure parts, tested.
import { parseTemplate, render } from "@/lib/template";

export type SplitTest = { share: number; plain_subject: string; plain_body: string };
export type SplitVariant = "holdout" | "firstline";

const SLOT = /\[\[[^\]]*\]\]/g;

/**
 * The plain version of a FirstLine template: the [[slots]] taken out, and lines left empty by them
 * dropped. Variables ({{first_name}}…) stay: they're filled in per lead when the email is written.
 */
export function stripSlots(text: string): string {
  return text
    .split("\n")
    .flatMap((line) => {
      if (!SLOT.test(line)) return [line];
      SLOT.lastIndex = 0;
      const rest = line.replace(SLOT, "").replace(/[ \t]{2,}/g, " ").trim();
      return rest ? [rest] : [];
    })
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/** The plain email for one lead: its variables filled in, nothing personalised. */
export function renderPlain(split: Pick<SplitTest, "plain_subject" | "plain_body">, vars: Record<string, string | null>): { subject: string; body: string } {
  const t = parseTemplate({ subject: split.plain_subject, body: split.plain_body });
  return {
    subject: render(t.subject, vars, {}, () => "").replace(/\s+/g, " ").trim(),
    body: render(t.body, vars, {}, () => "").replace(/[ \t]+\n/g, "\n").replace(/\n{3,}/g, "\n\n").trim(),
  };
}

/**
 * Which half each lead gets. Leads already written (e.g. the free preview) count as FirstLine; the rest
 * are shuffled so the whole campaign ends up at `share` holdout (rounded), spread over the list.
 */
export function assignVariants(leads: { id: string; written: boolean }[], share: number, random: () => number = Math.random): Map<string, SplitVariant> {
  const out = new Map<string, SplitVariant>();
  const open = leads.filter((l) => !l.written);
  for (const l of leads) if (l.written) out.set(l.id, "firstline");
  const holdoutTarget = Math.min(open.length, Math.round(leads.length * share));
  const shuffled = [...open];
  for (let i = shuffled.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
  }
  shuffled.forEach((l, i) => out.set(l.id, i < holdoutTarget ? "holdout" : "firstline"));
  return out;
}

export type HalfStats = { contacted: number; replied: number; positive: number; replyRate: number | null; positiveRate: number | null };

export function halfStats(c: { contacted: number; replied: number; positive: number }): HalfStats {
  return { ...c, replyRate: c.contacted ? c.replied / c.contacted : null, positiveRate: c.contacted ? c.positive / c.contacted : null };
}
