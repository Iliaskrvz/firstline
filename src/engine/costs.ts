// Real cost per call (§9: log every AI and API call to usage_costs).
import type { CostEntry } from "./types";

/** USD per million tokens. Cache writes are 1.25x input, cache reads ~0.1x. */
export const ANTHROPIC_PRICES: Record<string, { input: number; output: number; cacheRead: number; cacheWrite: number }> = {
  "claude-haiku-5-5": { input: 0.1, output: 0.5, cacheRead: 0.01, cacheWrite: 0.125 },
  "claude-sonnet-5-5": { input: 2, output: 10, cacheRead: 0.2, cacheWrite: 2.5 },
};

export type TokenUsage = {
  input_tokens: number;
  output_tokens: number;
  cache_read_input_tokens?: number | null;
  cache_creation_input_tokens?: number | null;
};

export function anthropicCost(model: string, u: TokenUsage): number {
  const p = ANTHROPIC_PRICES[model];
  if (!p) return 0;
  const usd =
    (u.input_tokens * p.input +
      u.output_tokens * p.output +
      (u.cache_read_input_tokens ?? 0) * p.cacheRead +
      (u.cache_creation_input_tokens ?? 0) * p.cacheWrite) /
    1_000_000;
  return Math.round(usd * 1e6) / 1e6;
}

export function anthropicCostEntry(step: CostEntry["step"], model: string, u: TokenUsage): CostEntry {
  return {
    step,
    model,
    input_tokens: u.input_tokens,
    output_tokens: u.output_tokens,
    cached_tokens: (u.cache_read_input_tokens ?? 0) + (u.cache_creation_input_tokens ?? 0),
    cost_usd: anthropicCost(model, u),
  };
}

export function firecrawlCostEntry(kind: "map" | "scrape", credits: number, usdPerCredit: number): CostEntry {
  return { step: "scrape", model: `firecrawl-${kind}`, provider_units: credits, cost_usd: Math.round(credits * usdPerCredit * 1e6) / 1e6 };
}

export function totalCost(entries: Pick<CostEntry, "cost_usd">[]): number {
  return Math.round(entries.reduce((s, e) => s + Number(e.cost_usd), 0) * 1e6) / 1e6;
}
