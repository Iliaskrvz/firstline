// Own use (owner's request 2026-11-27): one workspace (the owner's) may use the real Claude provider
// while everyone else stays on the server's provider (test output today). Pure rules, tested; the
// database side is src/lib/own-use-pg.ts and the worker applies the decision per lead.

export type OwnUseDecision = { use: "default" } | { use: "claude" } | { use: "blocked"; reason: string };

/** OWN_USE_MONTHLY_CAP_USD: the most own use may cost per calendar month (AI and website reading). */
export function ownUseCapUsd(env: Record<string, string | undefined> = process.env): number | null {
  const v = Number(env.OWN_USE_MONTHLY_CAP_USD?.trim());
  return Number.isFinite(v) && v > 0 ? v : null;
}

/**
 * Which AI a lead of this workspace gets. Never falls back to test output for an own-use workspace:
 * without a key or a cap, or with the cap reached, its leads stop with a clear reason instead, so no
 * test text can be sent to a real lead by mistake.
 */
export function ownUseDecision(input: { override: "anthropic" | null; hasKey: boolean; capUsd: number | null; spentUsd: number }): OwnUseDecision {
  if (!input.override) return { use: "default" };
  if (!input.hasKey) return { use: "blocked", reason: "Own use: ANTHROPIC_API_KEY is missing" };
  if (input.capUsd == null) return { use: "blocked", reason: "Own use: set OWN_USE_MONTHLY_CAP_USD first" };
  if (input.spentUsd >= input.capUsd) return { use: "blocked", reason: `Own use: this month's cap of $${input.capUsd} is reached` };
  return { use: "claude" };
}
