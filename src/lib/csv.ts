// CSV upload: parse -> auto-map columns -> apply mapping (validate, dedupe on
// email, normalise domains, flag rows without a website). Pure functions so the
// browser can preview and the server can re-run the exact same logic.
import Papa from "papaparse";
import { isFreeMailDomain, normaliseDomain } from "./domain";

export const LEAD_FIELDS = [
  "email",
  "first_name",
  "last_name",
  "full_name",
  "company",
  "title",
  "linkedin_headline",
  "website",
] as const;
export type LeadField = (typeof LEAD_FIELDS)[number];
export type ColumnTarget = LeadField | "custom" | "ignore";
export type ColumnMap = Record<string, ColumnTarget>;

export const FIELD_LABELS: Record<ColumnTarget, string> = {
  email: "Email",
  first_name: "First name",
  last_name: "Last name",
  full_name: "Full name (split)",
  company: "Company",
  title: "Job title",
  linkedin_headline: "LinkedIn headline",
  website: "Website",
  custom: "Custom variable",
  ignore: "Ignore",
};

export type ParsedCsv = {
  headers: string[];
  rows: Record<string, string>[];
  /** Spreadsheet row number of each row (header = 1, first data row = 2). */
  rowNumbers: number[];
  errors: string[];
};

export const MAX_ROWS = 20_000;

/** Pick the delimiter from the header line: the most frequent of ; , tab |, outside quotes. */
export function detectDelimiter(text: string): string {
  const header = text.split(/\r?\n/, 1)[0].replace(/"[^"]*"/g, "");
  const counts = [";", ",", "\t", "|"].map((d) => [d, header.split(d).length - 1] as const);
  const [best, n] = counts.reduce((a, b) => (b[1] > a[1] ? b : a));
  return n > 0 ? best : ",";
}

export function parseCsv(text: string): ParsedCsv {
  const clean = text.replace(/^﻿/, "");
  const seen = new Map<string, number>();
  const result = Papa.parse<Record<string, string>>(clean, {
    header: true,
    skipEmptyLines: false, // keep blank lines so row numbers match Excel/Sheets
    delimiter: detectDelimiter(clean),
    transformHeader: (h, i) => {
      let name = h.trim() || `Column ${i + 1}`;
      const n = seen.get(name.toLowerCase()) ?? 0;
      seen.set(name.toLowerCase(), n + 1);
      if (n > 0) name = `${name} (${n + 1})`;
      return name;
    },
    transform: (v) => (typeof v === "string" ? v.trim() : v),
  });

  const headers = result.meta.fields ?? [];
  const errors = result.errors
    // Short/long rows are common in exported lists and harmless.
    .filter((e) => e.code !== "TooFewFields" && e.code !== "TooManyFields")
    .slice(0, 5)
    .map((e) => (e.row != null ? `Row ${e.row + 2}: ${e.message}` : e.message));

  let rows: Record<string, string>[] = [];
  let rowNumbers: number[] = [];
  result.data.forEach((r, i) => {
    const out: Record<string, string> = {};
    for (const h of headers) out[h] = r[h] == null ? "" : String(r[h]).trim();
    if (Object.values(out).some((v) => v !== "")) {
      rows.push(out);
      rowNumbers.push(i + 2);
    }
  });

  if (headers.length === 0) errors.push("No header row found.");
  if (rows.length > MAX_ROWS) {
    errors.push(`File has ${rows.length} rows; only the first ${MAX_ROWS} are used.`);
    rows = rows.slice(0, MAX_ROWS);
    rowNumbers = rowNumbers.slice(0, MAX_ROWS);
  }
  return { headers, rows, rowNumbers, errors };
}

const SYNONYMS: Record<LeadField, string[]> = {
  email: ["email", "e-mail", "email address", "e-mail address", "emailadres", "e-mailadres", "mail", "work email", "business email", "e-mail-adresse"],
  first_name: ["first name", "firstname", "first", "given name", "voornaam", "vorname", "prenom", "prénom"],
  last_name: ["last name", "lastname", "surname", "family name", "achternaam", "nachname"],
  full_name: ["name", "full name", "fullname", "naam", "volledige naam", "contact name", "contact", "contact person", "contactpersoon"],
  company: ["company", "company name", "companyname", "bedrijf", "bedrijfsnaam", "organisation", "organization", "organisatie", "firma", "unternehmen", "account name", "account"],
  title: ["title", "job title", "jobtitle", "functie", "functietitel", "position", "role", "position title", "job"],
  linkedin_headline: ["linkedin headline", "headline", "linkedin bio"],
  website: ["website", "url", "company website", "website url", "web", "homepage", "domain", "company domain", "site", "webseite", "websiteurl", "company url"],
};

const squash = (s: string) => s.toLowerCase().normalize("NFKD").replace(/[^a-z0-9]/g, "");

const SYNONYM_INDEX = new Map<string, LeadField>();
for (const field of LEAD_FIELDS) for (const s of SYNONYMS[field]) SYNONYM_INDEX.set(squash(s), field);

/** Guess a mapping from header names. Each lead field is used at most once. */
export function autoMapColumns(headers: string[]): ColumnMap {
  const map: ColumnMap = {};
  const used = new Set<LeadField>();
  for (const h of headers) {
    const field = SYNONYM_INDEX.get(squash(h));
    if (field && !used.has(field)) {
      map[h] = field;
      used.add(field);
    } else {
      map[h] = "custom";
    }
  }
  // A "full name" column is only needed when there's no separate first name.
  if (used.has("full_name") && used.has("first_name")) {
    for (const h of headers) if (map[h] === "full_name") map[h] = "custom";
  }
  return map;
}

/** Slug used for {{custom}} variables: "Industry Sector" -> "industry_sector". */
export function toVariableKey(header: string): string {
  const key = header
    .toLowerCase()
    .replace(/ß/g, "ss")
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
  if (!key) return "field";
  return /^[a-z]/.test(key) ? key : `f_${key}`;
}

export type MappedLead = {
  email: string;
  first_name: string | null;
  last_name: string | null;
  company: string | null;
  title: string | null;
  linkedin_headline: string | null;
  website: string | null;
  domain: string | null;
  custom: Record<string, string>;
};

export type RowIssue = {
  /** Spreadsheet row number (header = 1, first data row = 2). */
  row: number;
  reason: "missing_email" | "invalid_email" | "duplicate" | "no_website";
  detail?: string;
};

export type MappingResult = {
  leads: MappedLead[];
  issues: RowIssue[];
  stats: {
    total: number;
    imported: number;
    duplicates: number;
    missing_email: number;
    invalid_email: number;
    no_website: number;
    personal_email: number;
  };
};

const EMAIL = /^[^\s@<>()",;:]+@[^\s@<>()",;:]+\.[a-z]{2,63}$/i;

export function cleanEmail(raw: string): string {
  return raw.trim().replace(/^mailto:/i, "").replace(/^<|>$/g, "").toLowerCase();
}

export function isValidEmail(raw: string): boolean {
  return EMAIL.test(cleanEmail(raw));
}

export function mappingErrors(map: ColumnMap): string[] {
  const errors: string[] = [];
  const counts = new Map<ColumnTarget, number>();
  for (const t of Object.values(map)) counts.set(t, (counts.get(t) ?? 0) + 1);
  if (!counts.get("email")) errors.push("Pick which column holds the email address.");
  for (const f of LEAD_FIELDS) {
    if ((counts.get(f) ?? 0) > 1) errors.push(`"${FIELD_LABELS[f]}" is mapped to more than one column.`);
  }
  return errors;
}

const blank = (v: string | undefined) => {
  const s = (v ?? "").trim();
  return s ? s : null;
};

export function applyMapping(rows: Record<string, string>[], map: ColumnMap, rowNumbers?: number[]): MappingResult {
  const col = (f: LeadField) => Object.keys(map).find((h) => map[h] === f);
  const cols = {
    email: col("email"),
    first_name: col("first_name"),
    last_name: col("last_name"),
    full_name: col("full_name"),
    company: col("company"),
    title: col("title"),
    linkedin_headline: col("linkedin_headline"),
    website: col("website"),
  };
  const customCols = Object.keys(map).filter((h) => map[h] === "custom");
  const customKeys = uniqueKeys(customCols);

  const leads: MappedLead[] = [];
  const issues: RowIssue[] = [];
  const seen = new Set<string>();
  const stats = { total: rows.length, imported: 0, duplicates: 0, missing_email: 0, invalid_email: 0, no_website: 0, personal_email: 0 };

  rows.forEach((r, i) => {
    const rowNo = rowNumbers?.[i] ?? i + 2;
    const rawEmail = cols.email ? (r[cols.email] ?? "").trim() : "";
    const email = cleanEmail(rawEmail);

    if (!email) {
      stats.missing_email++;
      issues.push({ row: rowNo, reason: "missing_email" });
      return;
    }
    if (!EMAIL.test(email)) {
      stats.invalid_email++;
      issues.push({ row: rowNo, reason: "invalid_email", detail: rawEmail });
      return;
    }
    if (seen.has(email)) {
      stats.duplicates++;
      issues.push({ row: rowNo, reason: "duplicate", detail: email });
      return;
    }
    seen.add(email);

    let first = cols.first_name ? blank(r[cols.first_name]) : null;
    let last = cols.last_name ? blank(r[cols.last_name]) : null;
    if (cols.full_name && !first) {
      const full = blank(r[cols.full_name]);
      if (full) {
        const [f, ...rest] = full.split(/\s+/);
        first = f;
        last = last ?? (rest.length ? rest.join(" ") : null);
      }
    }

    const website = cols.website ? blank(r[cols.website]) : null;
    const domain = normaliseDomain(website);
    if (!domain) {
      stats.no_website++;
      issues.push({ row: rowNo, reason: "no_website", detail: website ?? undefined });
    }
    if (isFreeMailDomain(email.split("@")[1])) stats.personal_email++;

    const custom: Record<string, string> = {};
    customCols.forEach((h, j) => {
      const v = blank(r[h]);
      if (v) custom[customKeys[j]] = v;
    });

    leads.push({
      email,
      first_name: first,
      last_name: last,
      company: cols.company ? blank(r[cols.company]) : null,
      title: cols.title ? blank(r[cols.title]) : null,
      linkedin_headline: cols.linkedin_headline ? blank(r[cols.linkedin_headline]) : null,
      website,
      domain,
      custom,
    });
  });

  stats.imported = leads.length;
  return { leads, issues, stats };
}

/** Variable keys for custom columns, de-duplicated and never clashing with built-ins. */
export function uniqueKeys(headers: string[]): string[] {
  const builtIn = new Set<string>(["email", "first_name", "last_name", "company", "title", "linkedin_headline", "website", "domain"]);
  const used = new Set<string>(builtIn);
  const out: string[] = [];
  for (const h of headers) {
    let k = toVariableKey(h);
    if (builtIn.has(k)) k = `custom_${k}`;
    let candidate = k;
    let n = 2;
    while (used.has(candidate)) candidate = `${k}_${n++}`;
    used.add(candidate);
    out.push(candidate);
  }
  return out;
}

/** Variables a template can use for a campaign with this mapping. */
export function availableVariables(map: ColumnMap): string[] {
  const vars = new Set<string>(["email"]);
  const has = (f: LeadField) => Object.values(map).includes(f);
  if (has("first_name") || has("full_name")) vars.add("first_name");
  if (has("last_name") || has("full_name")) vars.add("last_name");
  for (const f of ["company", "title", "linkedin_headline", "website"] as const) if (has(f)) vars.add(f);
  if (has("website")) vars.add("domain");
  for (const k of uniqueKeys(Object.keys(map).filter((h) => map[h] === "custom"))) vars.add(k);
  return [...vars];
}

// ---------------------------------------------------------------------------
// File decoding
// ---------------------------------------------------------------------------

/**
 * Excel on Windows (and many Dutch/German exports) saves CSV as Windows-1252,
 * not UTF-8. Try UTF-8 strictly first, then fall back, so é/ë/ü survive.
 */
export function decodeCsvBytes(bytes: Uint8Array): { text: string; encoding: "utf-8" | "utf-16le" | "windows-1252" } {
  if (bytes[0] === 0xff && bytes[1] === 0xfe) {
    return { text: new TextDecoder("utf-16le").decode(bytes.subarray(2)), encoding: "utf-16le" };
  }
  const start = bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf ? 3 : 0;
  try {
    return { text: new TextDecoder("utf-8", { fatal: true }).decode(bytes.subarray(start)), encoding: "utf-8" };
  } catch {
    return { text: new TextDecoder("windows-1252").decode(bytes), encoding: "windows-1252" };
  }
}

// ---------------------------------------------------------------------------
// Column analysis: header names + what's actually in the columns
// ---------------------------------------------------------------------------

/** Auto-map a column as Email only when at least this share of its values are emails. */
export const EMAIL_AUTOMAP_SHARE = 0.8;

export type EmailSuggestion = { header: string; valid: number; filled: number };

export type ColumnAnalysis = {
  map: ColumnMap;
  /** A column that contains some emails but wasn't auto-mapped. */
  emailSuggestion: EmailSuggestion | null;
  /** False when no column looks like email AND none looks like website. */
  looksLikeLeadList: boolean;
};

export function emailStats(rows: Record<string, string>[], header: string): { valid: number; filled: number } {
  let valid = 0;
  let filled = 0;
  for (const r of rows) {
    const v = (r[header] ?? "").trim();
    if (!v) continue;
    filled++;
    if (isValidEmail(v)) valid++;
  }
  return { valid, filled };
}

export function analyseColumns(headers: string[], rows: Record<string, string>[]): ColumnAnalysis {
  const map = autoMapColumns(headers);
  let emailSuggestion: EmailSuggestion | null = null;

  if (!Object.values(map).includes("email")) {
    // Only columns whose header told us nothing specific are candidates.
    const candidates = headers
      .filter((h) => map[h] === "custom" || map[h] === "full_name")
      .map((h) => ({ header: h, ...emailStats(rows, h) }))
      .filter((c) => c.valid > 0)
      .sort((a, b) => b.valid / b.filled - a.valid / a.filled || b.valid - a.valid);

    const best = candidates[0];
    if (best && best.valid / best.filled >= EMAIL_AUTOMAP_SHARE) {
      map[best.header] = "email";
    } else if (best) {
      emailSuggestion = best;
    }
  }

  const targets = Object.values(map);
  return { map, emailSuggestion, looksLikeLeadList: targets.includes("email") || targets.includes("website") };
}

/** Which screen the upload shows. */
export function uploadView(analysis: Pick<ColumnAnalysis, "looksLikeLeadList">, pickManually: boolean): "wrong_file" | "mapping" {
  return analysis.looksLikeLeadList || pickManually ? "mapping" : "wrong_file";
}

/** Why the Import button is disabled (null = ready to import). */
export function importBlocker(map: ColumnMap, stats: MappingResult["stats"]): string | null {
  const mapErr = mappingErrors(map);
  if (mapErr.length) return mapErr[0];
  if (stats.imported > 0) return null;
  if (stats.total === 0) return "The file has no data rows.";
  if (stats.missing_email === stats.total) return "Nothing to import: the email column is empty in every row.";
  return "Nothing to import: no row has a valid email address.";
}

// ---------------------------------------------------------------------------
// "Rows that need attention", grouped with copy that matches the issue
// ---------------------------------------------------------------------------

export const ISSUE_GROUPS: { reason: RowIssue["reason"]; title: string; intro: string; tone: "red" | "amber" }[] = [
  { reason: "missing_email", title: "No email", intro: "Skipped: we can't send without an email address.", tone: "red" },
  { reason: "invalid_email", title: "Invalid email", intro: "Skipped: this isn't a valid email address.", tone: "red" },
  { reason: "duplicate", title: "Duplicate", intro: "Skipped: same email as an earlier row. We keep the first one.", tone: "red" },
  { reason: "no_website", title: "No website", intro: "Imported, gets the neutral fallback line (free).", tone: "amber" },
];

export function groupIssues(issues: RowIssue[]) {
  return ISSUE_GROUPS.map((g) => ({ ...g, rows: issues.filter((i) => i.reason === g.reason) })).filter((g) => g.rows.length > 0);
}
