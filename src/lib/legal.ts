// Company details for the legal pages, from settings (no hard-coded legal entity).
export type Company = { name: string; address: string; kvk: string; vat: string; email: string; complete: boolean };

export function company(env: Record<string, string | undefined> = process.env): Company {
  const v = (k: string) => env[k]?.trim() || "";
  const c = { name: v("LEGAL_NAME"), address: v("LEGAL_ADDRESS"), kvk: v("LEGAL_KVK"), vat: v("LEGAL_VAT"), email: v("LEGAL_EMAIL") };
  const missing = "[to be completed]";
  return {
    name: c.name || missing,
    address: c.address || missing,
    kvk: c.kvk || missing,
    vat: c.vat || missing,
    email: c.email || missing,
    complete: !!(c.name && c.address && c.kvk && c.email),
  };
}

export const LEGAL_UPDATED = "10 November 2026";

const hostName = process.env.LEGAL_HOST_NAME?.trim() || "Server hosting provider [to be completed]";
const hostLocation = process.env.LEGAL_HOST_LOCATION?.trim() || "[to be completed]";

/** §11 sub-processors (Polar replaces Kelviq; no Google Maps Platform: the Local add-on was dropped). */
export const SUBPROCESSORS = [
  { name: "Supabase Inc.", purpose: "Database, sign-in", data: "Account data, lead lists, generated emails", location: "EU (Ireland)" },
  { name: "Anthropic PBC", purpose: "AI: reading facts from websites, writing and checking the personalised lines", data: "Company website text, lead first name, company, job title", location: "United States (SCCs)" },
  { name: "Firecrawl (Mendable Inc.)", purpose: "Reading public company websites", data: "Company website addresses", location: "United States (SCCs)" },
  { name: "Polar Software, Inc.", purpose: "Payments and invoicing (merchant of record)", data: "Billing name, email, address, VAT number, payment details", location: "United States (SCCs)" },
  { name: "Resend Inc.", purpose: "Service emails (e.g. inbox offline alerts)", data: "Account email address", location: "United States (SCCs)" },
  { name: hostName, purpose: "Running the FirstLine application and worker", data: "All data passes through it", location: hostLocation },
] as const;
