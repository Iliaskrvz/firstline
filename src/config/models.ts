// The only place model IDs, per-step model choices, prices and the bake-off setup live (SPEC §13).
// Two providers: DeepSeek (the default for AI steps since 2026-11-13, owner's decision) and Anthropic
// (kept, unused, so one setting switches back). LLM_PROVIDER=deepseek | anthropic | fake picks one.

export const PROVIDERS = ["deepseek", "anthropic"] as const;
export type Provider = (typeof PROVIDERS)[number];

export const ANTHROPIC_MODELS = ["claude-haiku-5-5", "claude-sonnet-5-5", "claude-opus-5-5"] as const;
export const DEEPSEEK_MODELS = ["deepseek-flash", "deepseek-v4-pro"] as const;
export type AnthropicModel = (typeof ANTHROPIC_MODELS)[number];
export type DeepSeekModel = (typeof DEEPSEEK_MODELS)[number];
export type ModelId = AnthropicModel | DeepSeekModel;

export const providerOf = (model: string): Provider => (model.startsWith("deepseek-") ? "deepseek" : "anthropic");

/**
 * How hard the model thinks. DeepSeek: "none" turns thinking off (the default for every step: our
 * steps are short and structured, and thinking only adds output tokens). Anthropic: output_config.effort.
 */
export type Effort = "none" | "low" | "medium" | "high";

export type StepModel = {
  model: ModelId;
  effort: Effort;
  /**
   * Economy: Anthropic runs it through the Message Batches API; DeepSeek holds it until off-peak hours
   * (half price). Either way the result comes later, not right away.
   */
  batch?: boolean;
};

export const STEPS = ["extraction", "writer_pro", "writer_lite", "writer_economy", "judge", "judge_sample", "testset_judge"] as const;
export type Step = (typeof STEPS)[number];
export type StepModels = Record<Step, StepModel>;

/** Model per step and provider. Don't change these without the owner's OK. */
export const STEP_MODELS_BY_PROVIDER: Record<Provider, StepModels> = {
  // Owner's brief, 2026-11-13.
  deepseek: {
    extraction: { model: "deepseek-flash", effort: "none" },
    writer_pro: { model: "deepseek-v4-pro", effort: "none" },
    writer_lite: { model: "deepseek-flash", effort: "none" },
    writer_economy: { model: "deepseek-v4-pro", effort: "none", batch: true },
    judge: { model: "deepseek-flash", effort: "none" },
    /** Planned 5% double-check of the judge; not wired into campaigns yet. */
    judge_sample: { model: "deepseek-v4-pro", effort: "none" },
    testset_judge: { model: "deepseek-v4-pro", effort: "none" },
  },
  // The Claude setup as of 2026-11-13, kept for switching back.
  anthropic: {
    extraction: { model: "claude-haiku-5-5", effort: "low" },
    writer_pro: { model: "claude-sonnet-5-5", effort: "medium" },
    writer_lite: { model: "claude-haiku-5-5", effort: "medium" },
    writer_economy: { model: "claude-sonnet-5-5", effort: "medium", batch: true },
    judge: { model: "claude-haiku-5-5", effort: "low" },
    judge_sample: { model: "claude-sonnet-5-5", effort: "low" },
    testset_judge: { model: "claude-opus-5-5", effort: "low" },
  },
};

/** The step models for an LLM_PROVIDER value ("fake" shows the DeepSeek setup; it uses no model). */
export function stepModels(provider: string): StepModels {
  return provider === "anthropic" ? STEP_MODELS_BY_PROVIDER.anthropic : STEP_MODELS_BY_PROVIDER.deepseek;
}

export const JUDGE_SAMPLE_RATE = 0.05;

/** Anthropic's server-side refusal fallback (beta) exists for Sonnet and Opus; Haiku and DeepSeek have none. */
export const HAS_SERVER_FALLBACK: Record<string, boolean> = { "claude-sonnet-5-5": true, "claude-opus-5-5": true };

// --- Anthropic prices --------------------------------------------------------------------------------

export type AnthropicPrice = { input: number; output: number; cacheRead: number; cacheWrite: number };

/** USD per million tokens, checked against platform.claude.com/docs/en/about-claude/pricing on 2026-11-13. */
export const PRICES: Record<AnthropicModel, AnthropicPrice & { longPrompt?: { overTokens: number } & AnthropicPrice }> = {
  "claude-haiku-5-5": {
    input: 0.1,
    output: 0.5,
    cacheRead: 0.01,
    cacheWrite: 0.125,
    longPrompt: { overTokens: 100_000, input: 0.5, output: 2.5, cacheRead: 0.05, cacheWrite: 0.625 },
  },
  "claude-sonnet-5-5": { input: 2, output: 10, cacheRead: 0.1, cacheWrite: 2.5 },
  "claude-opus-5-5": { input: 4, output: 20, cacheRead: 0.2, cacheWrite: 5 },
};

/** The Message Batches API bills every token at half price; it stacks with caching. */
export const BATCH_DISCOUNT = 0.5;

// --- DeepSeek prices and hours -------------------------------------------------------------------------

export type DeepSeekPrice = { cacheHit: number; cacheMiss: number; output: number };

/**
 * USD per million tokens, checked against api-docs.deepseek.com/quick_start/pricing on 2026-11-13
 * (prices in force since 2026-08-16). Thinking is off for our steps; if it's on, its tokens count as output.
 */
export const DEEPSEEK_PRICES: Record<DeepSeekModel, { peak: DeepSeekPrice; offPeak: DeepSeekPrice }> = {
  "deepseek-flash": { offPeak: { cacheHit: 0.003, cacheMiss: 0.15, output: 0.6 }, peak: { cacheHit: 0.006, cacheMiss: 0.3, output: 1.2 } },
  "deepseek-v4-pro": { offPeak: { cacheHit: 0.022, cacheMiss: 0.66, output: 1.98 }, peak: { cacheHit: 0.044, cacheMiss: 1.32, output: 3.96 } },
};

/**
 * DeepSeek's peak hours (pricing page): 01:00–04:00 and 06:00–10:00 UTC, Monday to Friday, except Chinese
 * public holidays. Everything else is off-peak at half price. Peak windows fall on the same calendar
 * date in UTC and in China, so holidays are listed as UTC dates (YYYY-MM-DD).
 * Holidays: the State Council publishes the next year's list around November. No Chinese public
 * holidays fall between 2026-11-13 and 2026-12-31; add 2027's dates when they're published. A missing
 * holiday only makes us log the peak price (never too low) and hold Economy jobs a little longer.
 */
export const DEEPSEEK_PEAK = {
  weekdaysUtc: [1, 2, 3, 4, 5],
  windowsUtc: [
    { from: "01:00", to: "04:00" },
    { from: "06:00", to: "10:00" },
  ],
  holidays: [] as string[],
};

/** Requests to DeepSeek at once (account limit: Flash 2500, V4 Pro 500; we stay far below). */
export const DEEPSEEK_CONCURRENCY_LIMIT: Record<DeepSeekModel, number> = { "deepseek-flash": 2500, "deepseek-v4-pro": 500 };

export const DEEPSEEK_BASE_URL = "https://api.deepseek.com";

// --- Model bake-off -------------------------------------------------------------------------------------

export type BakeoffSetup = {
  /** Writer candidates, all writing from the same facts. */
  writers: Record<string, StepModel>;
  /** The writer the others are compared with. */
  baseline: string;
  /** Cheaper options; the best of these goes on the blind sheet against the baseline. */
  cheaper: string[];
  /** Extraction candidates, compared on the first `extractionLeads` leads. */
  extractors: Record<string, StepModel>;
  /** Scores every email and decides the pairwise comparisons. */
  judge: StepModel;
  /** Judges the same pairs, to see how often it agrees with `judge`. */
  agreementJudge: StepModel;
};

export const BAKEOFF_BY_PROVIDER: Record<Provider, BakeoffSetup> = {
  deepseek: {
    writers: {
      pro: { model: "deepseek-v4-pro", effort: "none" },
      flash: { model: "deepseek-flash", effort: "none" },
      pro_offpeak: { model: "deepseek-v4-pro", effort: "none", batch: true },
    },
    baseline: "pro",
    cheaper: ["flash", "pro_offpeak"],
    extractors: { flash: { model: "deepseek-flash", effort: "none" }, pro: { model: "deepseek-v4-pro", effort: "none" } },
    judge: { model: "deepseek-v4-pro", effort: "none" },
    agreementJudge: { model: "deepseek-flash", effort: "none" },
  },
  anthropic: {
    writers: {
      sonnet: { model: "claude-sonnet-5-5", effort: "medium" },
      haiku: { model: "claude-haiku-5-5", effort: "medium" },
      sonnet_batch: { model: "claude-sonnet-5-5", effort: "medium", batch: true },
      opus: { model: "claude-opus-5-5", effort: "low" },
    },
    baseline: "sonnet",
    cheaper: ["haiku", "sonnet_batch"],
    extractors: { haiku: { model: "claude-haiku-5-5", effort: "low" }, sonnet: { model: "claude-sonnet-5-5", effort: "low" } },
    judge: { model: "claude-opus-5-5", effort: "low" },
    agreementJudge: { model: "claude-haiku-5-5", effort: "low" },
  },
};

export const bakeoffSetup = (provider: string): BakeoffSetup => (provider === "anthropic" ? BAKEOFF_BY_PROVIDER.anthropic : BAKEOFF_BY_PROVIDER.deepseek);

export const BAKEOFF = {
  maxLeads: 100,
  extractionLeads: 30,
  blindPairs: 20,
  /** Hard budget for one whole bake-off, in USD (the AI provider; Firecrawl credits are counted separately). */
  budgetUsd: 20,
  /** Leads run fully before the cost is projected to the whole run. */
  pilotLeads: 5,
} as const;
