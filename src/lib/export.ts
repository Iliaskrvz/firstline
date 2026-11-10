// CSV export (§8 Lane B): every lead column plus the fl_ columns sending tools import as variables.
// Pure; the route only loads rows.

export type ExportLead = {
  id: string;
  email: string;
  first_name: string | null;
  last_name: string | null;
  company: string | null;
  title: string | null;
  linkedin_headline: string | null;
  website: string | null;
  domain: string | null;
  custom: Record<string, string> | null;
  status: string;
  status_detail: string | null;
  confidence: string | null;
};

export type ExportGeneration = {
  lead_id: string;
  step_no: number;
  subject: string | null;
  full_email: string | null;
  slot_outputs: Record<string, string> | null;
  facts_used: string[] | null;
  research: { facts?: { id: string; src?: string }[] } | null;
};

const BASE = ["email", "first_name", "last_name", "company", "title", "linkedin_headline", "website", "domain"] as const;

/**
 * Spreadsheet apps run cells starting with = + - @ as formulas ("CSV injection"); a leading
 * apostrophe makes them plain text. Website text ends up in these cells, so this matters.
 */
export function safeCell(v: string | null | undefined): string {
  const s = v ?? "";
  return /^[=+\-@\t\r]/.test(s) ? `'${s}` : s;
}

export function buildExport(
  leads: ExportLead[],
  generations: ExportGeneration[],
  opts: { slotKeys: string[]; followUpSteps: number[] },
): { headers: string[]; rows: string[][] } {
  const customKeys = [...new Set(leads.flatMap((l) => Object.keys(l.custom ?? {})))].filter((k) => !(BASE as readonly string[]).includes(k)).sort();
  const byLead = new Map<string, Map<number, ExportGeneration>>();
  for (const g of generations) {
    const m = byLead.get(g.lead_id) ?? new Map<number, ExportGeneration>();
    if (!m.has(g.step_no)) m.set(g.step_no, g); // callers pass newest first
    byLead.set(g.lead_id, m);
  }

  const headers = [
    ...BASE,
    ...customKeys,
    "fl_status",
    "fl_subject",
    ...opts.slotKeys.map((k) => `fl_${k}`),
    "fl_full_email",
    ...opts.followUpSteps.map((n) => `fl_followup_${n}`),
    "fl_sources",
    "fl_confidence",
  ];

  const rows = leads.map((l) => {
    const gens = byLead.get(l.id);
    const g1 = gens?.get(1);
    const facts = new Map((g1?.research?.facts ?? []).map((f) => [f.id, f.src ?? ""]));
    const sources = [...new Set((g1?.facts_used ?? []).map((id) => facts.get(id)).filter((s): s is string => !!s))].join(" | ");
    const written = l.status === "done" || l.status === "fallback";
    return [
      ...BASE.map((k) => l[k] ?? ""),
      ...customKeys.map((k) => l.custom?.[k] ?? ""),
      l.status === "done" ? "personalised" : l.status === "fallback" ? "fallback" : l.status,
      written ? (g1?.subject ?? "") : "",
      ...opts.slotKeys.map((k) => (written ? (g1?.slot_outputs?.[k] ?? "") : "")),
      written ? (g1?.full_email ?? "") : "",
      ...opts.followUpSteps.map((n) => (written ? (gens?.get(n)?.full_email ?? "") : "")),
      sources,
      l.confidence ?? "",
    ].map(safeCell);
  });
  return { headers, rows };
}

export function exportFileName(campaignName: string): string {
  const slug = campaignName.toLowerCase().normalize("NFKD").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 60) || "campaign";
  return `firstline-${slug}.csv`;
}
