// The only place Claude model IDs, per-step model choices and prices live (SPEC §13). Anthropic only:
// no other model providers (lead data would go to an extra sub-processor).
// Changing a step's model here changes it everywhere: campaigns, Economy batches, API jobs, the Lab.

export const MODEL_IDS = ["claude-haiku-5-5", "claude-sonnet-5-5", "claude-opus-5-5"] as const;
export type ModelId = (typeof MODEL_IDS)[number];

/** Effort (output_config.effort): how much the model thinks. Thinking tokens are billed as output. */
export type Effort = "low" | "medium" | "high";

export type StepModel = {
  model: ModelId;
  effort: Effort;
  /** Through the Message Batches API (half price, results within hours). */
  batch?: boolean;
};

export const STEPS = ["extraction", "writer_pro", "writer_lite", "writer_economy", "judge", "judge_sample", "testset_judge"] as const;
export type Step = (typeof STEPS)[number];
export type StepModels = Record<Step, StepModel>;

/**
 * Model per step. Owner's plan (2026-11-13): Haiku extracts and judges, Sonnet writes Pro, Haiku writes
 * Lite, Sonnet writes Economy through the Batch API; Opus only judges test sets (lowest effort).
 * Opus is not a default writer. Don't change these without the owner's OK.
 */
export const STEP_MODELS: StepModels = {
  /** Facts from the company's website (and the Deep person check, when that's on). */
  extraction: { model: "claude-haiku-5-5", effort: "low" },
  /** The default ("Pro") writer. */
  writer_pro: { model: "claude-sonnet-5-5", effort: "medium" },
  /** The Lite writer (Lite credits). */
  writer_lite: { model: "claude-haiku-5-5", effort: "medium" },
  /** Economy mode: the Pro writer through the Batch API. */
  writer_economy: { model: "claude-sonnet-5-5", effort: "medium", batch: true },
  /** Scores every written email before the customer sees it. */
  judge: { model: "claude-haiku-5-5", effort: "low" },
  /** Double-checks a 5% sample of the judge's verdicts (planned; not wired into campaigns yet). */
  judge_sample: { model: "claude-sonnet-5-5", effort: "low" },
  /** Quality Lab and the model bake-off: scores and compares test-set emails. */
  testset_judge: { model: "claude-opus-5-5", effort: "low" },
};

export const JUDGE_SAMPLE_RATE = 0.05;

/** Server-side refusal fallback (beta) exists for these models; Haiku has none. */
export const HAS_SERVER_FALLBACK: Record<ModelId, boolean> = {
  "claude-haiku-5-5": false,
  "claude-sonnet-5-5": true,
  "claude-opus-5-5": true,
};

export type Price = {
  /** USD per million tokens. */
  input: number;
  output: number;
  cacheRead: number;
  /** 5-minute cache writes (the only kind we use). */
  cacheWrite: number;
};

/**
 * Anthropic list prices, checked against platform.claude.com/docs/en/about-claude/pricing on 2026-11-13.
 * Thinking tokens are part of output_tokens and billed as output.
 */
export const PRICES: Record<ModelId, Price & { longPrompt?: { overTokens: number } & Price }> = {
  "claude-haiku-5-5": {
    input: 0.1,
    output: 0.5,
    cacheRead: 0.01,
    cacheWrite: 0.125,
    // A request whose whole prompt (input + cache reads + cache writes) is over 100k tokens pays 5x.
    longPrompt: { overTokens: 100_000, input: 0.5, output: 2.5, cacheRead: 0.05, cacheWrite: 0.625 },
  },
  "claude-sonnet-5-5": { input: 2, output: 10, cacheRead: 0.1, cacheWrite: 2.5 },
  "claude-opus-5-5": { input: 4, output: 20, cacheRead: 0.2, cacheWrite: 5 },
};

/** The Message Batches API bills every token at half price; it stacks with caching. */
export const BATCH_DISCOUNT = 0.5;

/** Model bake-off in the Quality Lab (run only with the owner's OK). */
export const BAKEOFF = {
  /** Writer candidates, all writing from the same facts. The first is the baseline the others are compared with. */
  writers: {
    sonnet: { model: "claude-sonnet-5-5", effort: "medium" },
    haiku: { model: "claude-haiku-5-5", effort: "medium" },
    sonnet_batch: { model: "claude-sonnet-5-5", effort: "medium", batch: true },
    opus: { model: "claude-opus-5-5", effort: "low" },
  } satisfies Record<string, StepModel>,
  baseline: "sonnet",
  /** Extraction candidates, compared on the first `extractionLeads` leads. */
  extractors: {
    haiku: { model: "claude-haiku-5-5", effort: "low" },
    sonnet: { model: "claude-sonnet-5-5", effort: "low" },
  } satisfies Record<string, StepModel>,
  maxLeads: 100,
  extractionLeads: 30,
  blindPairs: 20,
  /** Hard budget for one whole bake-off, in USD (Anthropic only; Firecrawl credits are counted separately). */
  budgetUsd: 20,
  /** Leads run fully before the cost is projected to the whole run. */
  pilotLeads: 5,
} as const;

export type BakeoffWriter = keyof typeof BAKEOFF.writers;
