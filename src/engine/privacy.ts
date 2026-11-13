// Data minimisation for AI providers (owner's hard rule, 2026-11-13): a lead's email address, first
// name, last name and LinkedIn URL never go to the model. Job title, company name and website text may.
// The writer refers to the person neutrally; {{first_name}} and other variables are filled in by our own
// code after the AI step. Every DeepSeek request is scrubbed with these values as a last safety net.

export type PersonalLead = {
  email?: string | null;
  first_name?: string | null;
  last_name?: string | null;
  custom?: Record<string, unknown> | null;
};

const EMAIL = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g;
const LINKEDIN = /(?:https?:\/\/)?(?:[a-z]{2,3}\.)?linkedin\.com\/[^\s"'<>)\]]*/gi;

/** The values of one lead that must never reach the model. */
export function personalValues(lead: PersonalLead): string[] {
  const out = new Set<string>();
  const add = (v: unknown) => {
    const s = typeof v === "string" ? v.trim() : "";
    if (s.length >= 2) out.add(s);
  };
  add(lead.email);
  add(lead.email?.split("@")[0]);
  add(lead.first_name);
  add(lead.last_name);
  if (lead.first_name && lead.last_name) add(`${lead.first_name} ${lead.last_name}`);
  for (const [k, v] of Object.entries(lead.custom ?? {})) if (/linkedin|e-?mail|first.?name|last.?name|voornaam|achternaam/i.test(k)) add(v);
  return [...out].sort((a, b) => b.length - a.length); // longest first: "Anna de Vries" before "Anna"
}

const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/**
 * Remove personal values, any email address and any LinkedIn URL from text before it goes to a model.
 * Names are matched as whole words (so "Mark" doesn't touch "market"), case-insensitive.
 */
export function scrub(text: string, personal: string[]): string {
  let t = text.replace(EMAIL, "[email]").replace(LINKEDIN, "[link]");
  for (const v of personal ?? []) {
    t = t.replace(new RegExp(`(?<![\\p{L}\\p{N}])${escape(v)}(?![\\p{L}\\p{N}])`, "giu"), "[contact]");
  }
  return t;
}
