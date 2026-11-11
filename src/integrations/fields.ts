// Which FirstLine output goes into which tool variable (pure; shared by the UI and the push job).

export type VariableMapping = { field: string; variable: string };

/** Fields a push can carry: subject, each slot, the full email, each personalised follow-up. */
export function availableFields(slotKeys: string[], followUpSteps: number[]): { field: string; label: string }[] {
  return [
    { field: "subject", label: "Subject" },
    ...slotKeys.map((k) => ({ field: `slot:${k}`, label: `Slot [[${k}]]` })),
    { field: "full_email", label: "Full personalised email" },
    ...followUpSteps.map((n) => ({ field: `followup:${n}`, label: `Follow-up step ${n}` })),
  ];
}

/** Defaults match the CSV export column names, so `{{fl_full_email}}` works in either place. */
export function defaultVariableMap(slotKeys: string[], followUpSteps: number[]): VariableMapping[] {
  return availableFields(slotKeys, followUpSteps).map(({ field }) => ({
    field,
    variable: field === "subject" ? "fl_subject" : field === "full_email" ? "fl_full_email" : field.startsWith("slot:") ? `fl_${field.slice(5)}` : `fl_followup_${field.slice(9)}`,
  }));
}

const VAR_RE = /^[A-Za-z][A-Za-z0-9_]{0,49}$/;
/** Names the core lead fields use in the tools; a custom variable with that name would clash. */
const RESERVED = new Set(["email", "first_name", "firstname", "last_name", "lastname", "company_name", "companyname", "website", "phone", "job_title", "personalization"]);

export function validateVariableMap(map: VariableMapping[], allowed: string[]): string | null {
  const used = map.filter((m) => m.variable.trim());
  if (!used.length) return "Map at least one field to a variable.";
  const seen = new Set<string>();
  for (const m of used) {
    if (!allowed.includes(m.field)) return `Unknown field ${m.field}.`;
    const v = m.variable.trim();
    if (!VAR_RE.test(v)) return `"${v}" is not a valid variable name: use letters, digits and _ (start with a letter, max 50).`;
    if (RESERVED.has(v.toLowerCase())) return `"${v}" is a built-in lead field in the tool; pick another name.`;
    if (seen.has(v.toLowerCase())) return `"${v}" is used twice.`;
    seen.add(v.toLowerCase());
  }
  return null;
}

export type LeadOutput = { subject: string | null; slots: Record<string, string> | null; full_email: string | null; followUps: Record<number, string | null> };

export function variablesFor(map: VariableMapping[], out: LeadOutput): Record<string, string> {
  const vars: Record<string, string> = {};
  for (const { field, variable } of map) {
    const name = variable.trim();
    if (!name) continue;
    const v =
      field === "subject" ? out.subject
      : field === "full_email" ? out.full_email
      : field.startsWith("slot:") ? (out.slots?.[field.slice(5)] ?? null)
      : field.startsWith("followup:") ? (out.followUps[Number(field.slice(9))] ?? null)
      : null;
    vars[name] = v ?? "";
  }
  return vars;
}
