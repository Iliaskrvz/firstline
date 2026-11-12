import { PACK_CONFIG, type Pack } from "@/config/packs";
// Credit pricing rules (§3, §9). Pure, shared by UI estimates and the engine.

/** Research add-ons per lead. Local (Google reviews) was dropped: Google's EEA terms don't allow it. */
export type Depth = { deep: boolean };

export const CREDITS = {
  base: 1,
  deep: 1,
} as const;

export function creditsPerLead(depth: Depth): number {
  return CREDITS.base + (depth?.deep ? CREDITS.deep : 0);
}

/**
 * Upper bound shown before a run ("≤ N credits"). Leads without a usable
 * website will fall back for free, so they don't count.
 */
export function estimateCredits(leadsWithWebsite: number, depth: Depth): number {
  return Math.max(0, leadsWithWebsite) * creditsPerLead(depth);
}

/** Credit packs (§9): see src/config/packs.ts. */
export type PackId = string;
export const PACKS: Record<PackId, Pack> = Object.fromEntries(PACK_CONFIG.map((p) => [p.id, p]));

/** Packs on sale: the config's "enabled", or PACKS_ENABLED (comma-separated ids) when set. */
export function enabledPacks(env: Record<string, string | undefined> = process.env): Pack[] {
  const list = env.PACKS_ENABLED?.split(",").map((x) => x.trim()).filter(Boolean);
  return PACK_CONFIG.filter((p) => (list?.length ? list.includes(p.id) : p.enabled));
}

export function isPackId(v: unknown): v is PackId {
  return typeof v === "string" && v in PACKS;
}

/** Price per credit in euro (for "€0.035 each"). */
export function perCreditEur(p: Pack): number {
  return p.priceCents / p.credits / 100;
}

/** "€19" / "€69" / "€299" (whole euros) or "€0.04" (per credit). */
export function euro(cents: number): string {
  return new Intl.NumberFormat("en-IE", { style: "currency", currency: "EUR", minimumFractionDigits: cents % 100 ? 2 : 0, maximumFractionDigits: 3 }).format(cents / 100);
}

/** Credits a run reserves: 1 per lead with a website (+ Deep) plus 1 per personalised follow-up. */
export function runCredits(leadsWithWebsite: number, depth: Depth, personalisedFollowUps: number): number {
  return Math.max(0, leadsWithWebsite) * (creditsPerLead(depth) + Math.max(0, personalisedFollowUps));
}
