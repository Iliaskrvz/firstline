// Real cost per call (§9: log every AI and API call to usage_costs). Prices: src/config/models.ts.
import { BATCH_DISCOUNT, DEEPSEEK_PEAK, DEEPSEEK_PRICES, PRICES, type AnthropicModel, type DeepSeekModel } from "@/config/models";
import type { CostEntry } from "./types";

export type TokenUsage = {
  input_tokens: number;
  output_tokens: number;
  cache_read_input_tokens?: number | null;
  cache_creation_input_tokens?: number | null;
};

export function anthropicCost(model: string, u: TokenUsage, opts: { batch?: boolean } = {}): number {
  const base = PRICES[model as AnthropicModel];
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

// --- DeepSeek ------------------------------------------------------------------------------------------

const minutes = (hhmm: string) => Number(hhmm.slice(0, 2)) * 60 + Number(hhmm.slice(3, 5));

/** Is this moment in DeepSeek's peak hours (full price)? Off-peak is half price. */
export function isDeepSeekPeak(at: Date, peak = DEEPSEEK_PEAK): boolean {
  if (!peak.weekdaysUtc.includes(at.getUTCDay())) return false;
  if (peak.holidays.includes(at.toISOString().slice(0, 10))) return false;
  const m = at.getUTCHours() * 60 + at.getUTCMinutes();
  return peak.windowsUtc.some((w) => m >= minutes(w.from) && m < minutes(w.to));
}

/** The next moment off-peak starts (or `at` itself when it's already off-peak). */
export function nextDeepSeekOffPeak(at: Date, peak = DEEPSEEK_PEAK): Date {
  const t = new Date(at);
  for (let i = 0; i < 24 * 60 && isDeepSeekPeak(t, peak); i++) t.setUTCMinutes(t.getUTCMinutes() + 1, 0, 0);
  return t;
}

export type DeepSeekUsage = { prompt_cache_hit_tokens?: number | null; prompt_cache_miss_tokens?: number | null; prompt_tokens?: number | null; completion_tokens: number };

/** Price by when the request ran. Cache hits are cheap; reasoning tokens (if any) are part of completion_tokens. */
export function deepseekCost(model: string, u: DeepSeekUsage, at: Date): number {
  const prices = DEEPSEEK_PRICES[model as DeepSeekModel];
  if (!prices) return 0;
  const p = isDeepSeekPeak(at) ? prices.peak : prices.offPeak;
  const hit = u.prompt_cache_hit_tokens ?? 0;
  const miss = u.prompt_cache_miss_tokens ?? Math.max(0, (u.prompt_tokens ?? 0) - hit);
  return Math.round(((hit * p.cacheHit + miss * p.cacheMiss + u.completion_tokens * p.output) / 1_000_000) * 1e6) / 1e6;
}

/**
 * usage_costs row: input_tokens = cache misses, cached_tokens = cache hits (recorded separately), and the
 * model label says "(off-peak)" when the half price applied.
 */
export function deepseekCostEntry(step: CostEntry["step"], model: string, u: DeepSeekUsage, at: Date): CostEntry {
  const hit = u.prompt_cache_hit_tokens ?? 0;
  const miss = u.prompt_cache_miss_tokens ?? Math.max(0, (u.prompt_tokens ?? 0) - hit);
  return {
    step,
    model: isDeepSeekPeak(at) ? model : `${model} (off-peak)`,
    input_tokens: miss,
    output_tokens: u.completion_tokens,
    cached_tokens: hit,
    cost_usd: deepseekCost(model, u, at),
  };
}

/** Either provider, from simple token counts (tests and estimates). */
export function modelCostEntry(step: CostEntry["step"], model: string, u: { input: number; output: number; cached?: number }, opts: { batch?: boolean; at?: Date } = {}): CostEntry {
  if (model.startsWith("deepseek-")) {
    return deepseekCostEntry(step, model, { prompt_cache_hit_tokens: u.cached ?? 0, prompt_cache_miss_tokens: u.input, completion_tokens: u.output }, opts.at ?? new Date());
  }
  return anthropicCostEntry(step, model, { input_tokens: u.input, output_tokens: u.output, cache_read_input_tokens: u.cached ?? 0 }, { batch: opts.batch });
}

export function firecrawlCostEntry(kind: "map" | "scrape" | "search", credits: number, usdPerCredit: number): CostEntry {
  return { step: kind === "search" ? "search" : "scrape", model: `firecrawl-${kind}`, provider_units: credits, cost_usd: Math.round(credits * usdPerCredit * 1e6) / 1e6 };
}

export function totalCost(entries: Pick<CostEntry, "cost_usd">[]): number {
  return Math.round(entries.reduce((s, e) => s + Number(e.cost_usd), 0) * 1e6) / 1e6;
}
