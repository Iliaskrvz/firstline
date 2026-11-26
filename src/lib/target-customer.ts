// Lead qualification (Part B), the parts the browser and the API share: the campaign's "Target
// customer" (who fits, who doesn't, how strict), its limits, example texts, labels and the warning
// rule. No server-only imports here.
import { z } from "zod";

export type Strictness = "strict" | "normal" | "loose";
export type TargetCustomer = { fits: string; excludes: string; strictness: Strictness };
export type Verdict = "fit" | "no_fit" | "unsure";

export const TARGET_MAX_CHARS = 600;

export const TargetCustomerSchema = z.object({
  fits: z.string().trim().max(TARGET_MAX_CHARS, `Keep "Who fits" under ${TARGET_MAX_CHARS} characters.`).default(""),
  excludes: z.string().trim().max(TARGET_MAX_CHARS, `Keep "Who doesn't fit" under ${TARGET_MAX_CHARS} characters.`).default(""),
  strictness: z.enum(["strict", "normal", "loose"]).default("normal"),
});

/** Empty text on both sides = qualification off (stored as null). */
export function normaliseTarget(t: z.input<typeof TargetCustomerSchema> | null | undefined): TargetCustomer | null {
  if (!t) return null;
  const v = TargetCustomerSchema.parse(t);
  return v.fits || v.excludes ? v : null;
}

export const STRICTNESS_LABEL: Record<Strictness, { label: string; hint: string }> = {
  strict: { label: "Strict", hint: "Only write to clear fits. Unsure leads are skipped (free)." },
  normal: { label: "Normal", hint: "Write to fits and unsure leads; unsure ones are flagged for you to check." },
  loose: { label: "Loose", hint: "Only skip clear non-fits." },
};

export const VERDICT_LABEL: Record<Verdict, string> = { fit: "Fits", no_fit: "Not a fit", unsure: "Unsure" };

/** Example texts on the campaign page (pick one, then edit). */
export const TARGET_EXAMPLES: { name: string; fits: string; excludes: string }[] = [
  {
    name: "Local service businesses",
    fits: "Independent bakeries, cafés or restaurants with their own shop, in the Netherlands or Belgium",
    excludes: "franchises or chains, wholesalers, webshops only",
  },
  {
    name: "B2B agencies",
    fits: "Marketing or design agencies that work for business clients, 5 to 50 people",
    excludes: "freelancers working alone, agencies that only serve consumers, recruitment agencies",
  },
  {
    name: "Installers and trades",
    fits: "Installers of solar panels, heat pumps or charging points for homes and businesses",
    excludes: "manufacturers, wholesalers, energy suppliers",
  },
];

/** The share of no_fit among qualified leads above which the campaign gets a warning, after at least 10. */
export const NO_FIT_WARNING = { minQualified: 10, share: 0.5 } as const;
export function noFitWarning(counts: { fit: number; no_fit: number; unsure: number }): boolean {
  const total = counts.fit + counts.no_fit + counts.unsure;
  return total >= NO_FIT_WARNING.minQualified && counts.no_fit / total > NO_FIT_WARNING.share;
}

export function verdictCounts(rows: { qualify_verdict?: string | null }[]) {
  const c = { fit: 0, no_fit: 0, unsure: 0 };
  for (const r of rows) if (r.qualify_verdict === "fit" || r.qualify_verdict === "no_fit" || r.qualify_verdict === "unsure") c[r.qualify_verdict]++;
  return c;
}
