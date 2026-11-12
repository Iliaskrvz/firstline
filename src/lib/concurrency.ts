// Leads in progress at once per workspace (Phase 10). Bigger buyers get more, automatically;
// the admin dashboard can set any workspace's limit by hand. Proposal: the owner decides the levels.

export const CONCURRENCY_LEVELS: { fromPurchased: number; limit: number }[] = [
  { fromPurchased: 0, limit: 5 },
  { fromPurchased: 2_000, limit: 10 }, // bought a Growth pack (or more)
  { fromPurchased: 10_000, limit: 20 }, // Agency pack
  { fromPurchased: 50_000, limit: 40 }, // volume packs
];

/** pg-boss never runs more than this for one workspace, whatever the setting. */
export const MAX_WORKSPACE_CONCURRENCY = 50;

export function concurrencyLevel(purchasedCredits: number): number {
  let limit = CONCURRENCY_LEVELS[0].limit;
  for (const l of CONCURRENCY_LEVELS) if (purchasedCredits >= l.fromPurchased) limit = l.limit;
  return limit;
}
