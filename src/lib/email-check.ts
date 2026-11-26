// Free email checks (Part A): format, throwaway domains, role addresses, personal (free-mail) addresses
// and typo domains. Pure: no network, no database. The domain's mail server (DNS) is checked separately
// in email-dns.ts, in the worker. NEVER add an SMTP or "mailbox ping" check here: connecting to
// port 25 from our servers gets them blacklisted (a test guards this).
import { readFileSync } from "node:fs";
import path from "node:path";
import { FREE_MAIL_DOMAINS } from "./domain";
import { type EmailReason, type EmailStatus } from "./email-check-labels";

export { REASON_LABEL, type EmailReason, type EmailStatus } from "./email-check-labels";

/** What a domain's DNS says about receiving mail (email-dns.ts). */
export type DomainResult = "mx" | "a_only" | "null_mx" | "none" | "unknown";

export const INVALID_REASONS: EmailReason[] = ["syntax", "disposable", "null_mx", "no_dns"];
export const RISKY_REASONS: EmailReason[] = ["typo", "a_only", "role", "personal", "dns_unknown"];


// Practical syntax: one @, no spaces or brackets, a dot in the domain, a 2–63 letter TLD.
const EMAIL = /^[^\s@<>()",;:\\[\]]{1,64}@(?=.{4,253}$)([a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/;

/** Trim, drop "mailto:" and angle brackets, lowercase (as the CSV import always did). */
export function normaliseEmail(raw: string): string {
  return raw.trim().replace(/^<|>$/g, "").trim().replace(/^mailto:/i, "").trim().toLowerCase();
}

let disposable: Set<string> | null = null;
/** The vendored CC0 list (src/lib/data/disposable-domains.txt; scripts/update-disposable-domains.ts). */
export function disposableDomains(): Set<string> {
  if (!disposable) {
    const text = readFileSync(path.join(process.cwd(), "src/lib/data/disposable-domains.txt"), "utf8");
    disposable = new Set(text.split("\n").map((l) => l.trim()).filter((l) => l && !l.startsWith("#")));
  }
  return disposable;
}

/** A domain or any parent domain on the throwaway list (sub.mailinator.com counts too). */
export function isDisposableDomain(domain: string, list: Set<string> = disposableDomains()): boolean {
  const parts = domain.split(".");
  for (let i = 0; i < parts.length - 1; i++) if (list.has(parts.slice(i).join("."))) return true;
  return false;
}

/** Shared mailboxes in English, Dutch and German. Matched on the part before @ (a "+tag" is ignored). */
export const ROLE_LOCAL_PARTS = new Set([
  // English
  "info", "sales", "contact", "office", "admin", "administrator", "support", "hello", "hi", "team", "marketing", "hr", "jobs",
  "careers", "billing", "accounts", "accounting", "finance", "invoices", "noreply", "no-reply", "donotreply", "postmaster",
  "webmaster", "hostmaster", "abuse", "help", "helpdesk", "service", "customerservice", "enquiries", "inquiries", "press", "media",
  "mail", "email", "general", "reception", "orders", "booking", "bookings", "reservations", "privacy", "legal", "security", "it",
  // Dutch
  "verkoop", "kantoor", "administratie", "klantenservice", "receptie", "secretariaat", "boekhouding", "facturen", "facturatie",
  "vacatures", "sollicitaties", "sollicitatie", "inkoop", "planning", "bestellingen", "algemeen",
  // German
  "vertrieb", "buero", "büro", "kontakt", "verwaltung", "buchhaltung", "kundenservice", "bewerbung", "bewerbungen", "empfang",
  "sekretariat", "rechnung", "rechnungen", "einkauf", "bestellung", "zentrale",
]);

export function isRoleAddress(email: string): boolean {
  const local = email.split("@")[0]?.split("+")[0] ?? "";
  return ROLE_LOCAL_PARTS.has(local);
}

const KNOWN_TYPOS: Record<string, string> = {
  "gmial.com": "gmail.com", "gmal.com": "gmail.com", "gmai.com": "gmail.com", "gamil.com": "gmail.com", "gnail.com": "gmail.com",
  "gmail.co": "gmail.com", "gmail.cm": "gmail.com", "gmaill.com": "gmail.com", "gmeil.com": "gmail.com", "gmil.com": "gmail.com",
  "hotmial.com": "hotmail.com", "hotmal.com": "hotmail.com", "hotmai.com": "hotmail.com", "hotmil.com": "hotmail.com", "hotamil.com": "hotmail.com",
  "hotmail.co": "hotmail.com", "hotmial.nl": "hotmail.nl", "hotmal.nl": "hotmail.nl",
  "outlok.com": "outlook.com", "outllok.com": "outlook.com", "outlook.co": "outlook.com", "otulook.com": "outlook.com", "outloo.com": "outlook.com",
  "yaho.com": "yahoo.com", "yahooo.com": "yahoo.com", "yhoo.com": "yahoo.com", "iclod.com": "icloud.com", "icoud.com": "icloud.com",
  "ziggo.n": "ziggo.nl", "zigo.nl": "ziggo.nl", "kpnmial.nl": "kpnmail.nl", "kpnmal.nl": "kpnmail.nl",
};
const COMMON_PROVIDERS = ["gmail.com", "hotmail.com", "hotmail.nl", "outlook.com", "outlook.nl", "live.com", "live.nl", "yahoo.com", "icloud.com", "ziggo.nl", "kpnmail.nl", "xs4all.nl", "planet.nl", "home.nl", "gmx.de", "gmx.net", "web.de", "t-online.de"];
const TLD_TYPOS: Record<string, string> = { con: "com", cmo: "com", ocm: "com", comm: "com", cpm: "com", vom: "com", nll: "nl" };

/** Exactly one insert, delete, change or swap of two neighbours apart. */
function oneEditApart(a: string, b: string): boolean {
  if (a === b || Math.abs(a.length - b.length) > 1) return false;
  let i = 0;
  while (i < a.length && i < b.length && a[i] === b[i]) i++;
  if (a.length === b.length) return a.slice(i + 1) === b.slice(i + 1) || (a[i] === b[i + 1] && a[i + 1] === b[i] && a.slice(i + 2) === b.slice(i + 2));
  return a.length > b.length ? a.slice(i + 1) === b.slice(i) : a.slice(i) === b.slice(i + 1);
}

/** "gmial.com" → "gmail.com". A suggestion only: addresses are never changed silently. */
export function suggestDomain(domain: string): string | null {
  if (KNOWN_TYPOS[domain]) return KNOWN_TYPOS[domain];
  if (FREE_MAIL_DOMAINS.has(domain) || COMMON_PROVIDERS.includes(domain)) return null;
  const tld = domain.split(".").pop() ?? "";
  if (TLD_TYPOS[tld]) return `${domain.slice(0, -tld.length)}${TLD_TYPOS[tld]}`;
  return COMMON_PROVIDERS.find((p) => oneEditApart(domain, p)) ?? null;
}

export type StaticCheck = { email: string; domain: string | null; invalid: EmailReason[]; risky: EmailReason[]; suggestion: string | null };

/** Everything that can be checked without the network. */
export function staticCheck(raw: string): StaticCheck {
  const email = normaliseEmail(raw);
  if (!EMAIL.test(email)) return { email, domain: null, invalid: ["syntax"], risky: [], suggestion: null };
  const domain = email.split("@")[1];
  const invalid: EmailReason[] = [];
  const risky: EmailReason[] = [];
  if (isDisposableDomain(domain)) invalid.push("disposable");
  const fix = suggestDomain(domain);
  if (fix) risky.push("typo");
  if (isRoleAddress(email)) risky.push("role");
  if (FREE_MAIL_DOMAINS.has(domain)) risky.push("personal");
  return { email, domain, invalid, risky, suggestion: fix ? `${email.split("@")[0]}@${fix}` : null };
}

export type EmailVerdict = { status: EmailStatus; reason: EmailReason | null; reasons: EmailReason[]; suggestion: string | null };

/** The static checks plus the domain's DNS result (null = not looked up yet → "pending" unless already invalid). */
export function combine(s: StaticCheck, dns: DomainResult | null): EmailVerdict {
  const invalid = [...s.invalid];
  const risky = [...s.risky];
  if (dns === "null_mx") invalid.push("null_mx");
  if (dns === "none") invalid.push("no_dns");
  if (dns === "a_only") risky.push("a_only");
  if (dns === "unknown") risky.push("dns_unknown");
  const order = (r: EmailReason[], o: EmailReason[]) => o.filter((x) => r.includes(x));
  if (invalid.length) {
    const reasons = [...order(invalid, INVALID_REASONS), ...order(risky, RISKY_REASONS)];
    return { status: "invalid", reason: reasons[0], reasons, suggestion: s.suggestion };
  }
  if (dns === null) return { status: "pending", reason: null, reasons: order(risky, RISKY_REASONS), suggestion: s.suggestion };
  const reasons = order(risky, RISKY_REASONS);
  return { status: reasons.length ? "risky" : "valid", reason: reasons[0] ?? null, reasons, suggestion: s.suggestion };
}

/** Counts per status and per reason, for the upload screen and the campaign's email-check card. */
export function summarise(verdicts: Pick<EmailVerdict, "status" | "reasons">[]) {
  const byStatus: Record<EmailStatus, number> = { pending: 0, valid: 0, risky: 0, invalid: 0 };
  const byReason: Partial<Record<EmailReason, number>> = {};
  for (const v of verdicts) {
    byStatus[v.status]++;
    // An invalid lead counts under its invalid reason only; a risky lead under each risky reason.
    const counted = v.status === "invalid" ? v.reasons.filter((r) => INVALID_REASONS.includes(r)).slice(0, 1) : v.reasons;
    for (const r of counted) byReason[r] = (byReason[r] ?? 0) + 1;
  }
  return { byStatus, byReason };
}
