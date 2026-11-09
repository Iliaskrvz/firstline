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

/** Until credits are wired into the pipeline (Phase 5), a full campaign run is free and capped at this many leads. */
export const MAX_FREE_RUN = 50;
