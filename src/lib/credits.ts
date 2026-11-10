// Credit pricing rules (§3, §9). Pure, shared by UI estimates and the engine.

export type Depth = { deep: boolean; local: boolean };

export const CREDITS = {
  base: 1,
  deep: 1,
  local: 2,
} as const;

export function creditsPerLead(depth: Depth): number {
  return CREDITS.base + (depth.deep ? CREDITS.deep : 0) + (depth.local ? CREDITS.local : 0);
}

/**
 * Upper bound shown before a run ("≤ N credits"). Leads without a usable
 * website will fall back for free, so they don't count.
 */
export function estimateCredits(leadsWithWebsite: number, depth: Depth): number {
  return Math.max(0, leadsWithWebsite) * creditsPerLead(depth);
}

/** Credit packs (§9), prices in euro cents excl. VAT. */
export const PACKS = {
  starter: { name: "Starter", credits: 500, priceCents: 1900 },
  growth: { name: "Growth", credits: 2000, priceCents: 6900 },
  agency: { name: "Agency", credits: 10000, priceCents: 29900 },
} as const;
export type PackId = keyof typeof PACKS;
export const PACK_IDS = Object.keys(PACKS) as PackId[];

export function isPackId(v: unknown): v is PackId {
  return typeof v === "string" && v in PACKS;
}

/** "€19" / "€69" / "€299" (whole euros) or "€0.04" (per credit). */
export function euro(cents: number): string {
  return new Intl.NumberFormat("en-IE", { style: "currency", currency: "EUR", minimumFractionDigits: cents % 100 ? 2 : 0, maximumFractionDigits: 3 }).format(cents / 100);
}

/** Credits a run reserves: 1 per lead with a website (+ Deep/Local) plus 1 per personalised follow-up. */
export function runCredits(leadsWithWebsite: number, depth: Depth, personalisedFollowUps: number): number {
  return Math.max(0, leadsWithWebsite) * (creditsPerLead(depth) + Math.max(0, personalisedFollowUps));
}
