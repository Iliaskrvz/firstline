// Real cost per call (§9: log every AI and API call to usage_costs). Prices: src/config/models.ts.
import { BATCH_DISCOUNT, PRICES, type ModelId } from "@/config/models";
import type { CostEntry } from "./types";

export type TokenUsage = {
  input_tokens: number;
  output_tokens: number;
  cache_read_input_tokens?: number | null;
  cache_creation_input_tokens?: number | null;
};

export function anthropicCost(model: string, u: TokenUsage, opts: { batch?: boolean } = {}): number {
  const base = PRICES[model as ModelId];
  if (!base) return 0;
  const read = u.cache_read_input_tokens ?? 0;
  const write = u.cache_creation_input_tokens ?? 0;
  const promptTokens = u.input_tokens + read + write;
  const p = base.longPrompt && promptTokens > base.longPrompt.overTokens ? base.longPrompt : base;
  const usd = (u.input_tokens * p.input + u.output_tokens * p.output + read * p.cacheRead + write * p.cacheWrite) / 1_000_000;
  return Math.round(usd * (opts.batch ? BATCH_DISCOUNT : 1) * 1e6) / 1e6;
}

export function anthropicCostEntry(step: CostEntry["step"], model: string, u: TokenUsage, opts: { batch?: boolean } = {}): CostEntry {
  return {
    step,
    model: opts.batch ? `${model} (batch)` : model,
    input_tokens: u.input_tokens,
    output_tokens: u.output_tokens,
    cached_tokens: (u.cache_read_input_tokens ?? 0) + (u.cache_creation_input_tokens ?? 0),
    cost_usd: anthropicCost(model, u, opts),
  };
}

export function firecrawlCostEntry(kind: "map" | "scrape" | "search", credits: number, usdPerCredit: number): CostEntry {
  return { step: kind === "search" ? "search" : "scrape", model: `firecrawl-${kind}`, provider_units: credits, cost_usd: Math.round(credits * usdPerCredit * 1e6) / 1e6 };
}

export function totalCost(entries: Pick<CostEntry, "cost_usd">[]): number {
  return Math.round(entries.reduce((s, e) => s + Number(e.cost_usd), 0) * 1e6) / 1e6;
}
