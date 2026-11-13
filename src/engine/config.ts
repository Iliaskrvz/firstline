// Engine settings. Everything tunable lives here; read from env with safe defaults.
import { stepModels, type StepModels } from "@/config/models";

const num = (v: string | undefined, d: number) => (v && Number.isFinite(Number(v)) ? Number(v) : d);

export type LlmProvider = "fake" | "anthropic" | "deepseek";

export function engineConfig(env: Record<string, string | undefined> = process.env, models: Partial<StepModels> = {}) {
  const p = env.LLM_PROVIDER?.trim();
  const provider: LlmProvider = p === "deepseek" || p === "anthropic" ? p : "fake";
  /** Provider-neutral names first; the old ANTHROPIC_ names still work. */
  const pick = (name: string, old: string) => env[name]?.trim() || env[old]?.trim() || undefined;
  return {
    /** "fake" = realistic test output, no AI used. LLM_PROVIDER=deepseek (default for AI) or anthropic. */
    llmProvider: provider,
    anthropicApiKey: env.ANTHROPIC_API_KEY?.trim() || null,
    deepseekApiKey: env.DEEPSEEK_API_KEY?.trim() || null,
    firecrawlApiKey: env.FIRECRAWL_API_KEY?.trim() || null,
    /** Model per step: src/config/models.ts. `models` overrides some (the Lab and the bake-off do). */
    models: { ...stepModels(provider), ...models } as StepModels,
    research: {
      maxPages: 4, // homepage + about/team + services + newest news (§5)
      maxPagesLite: 2,
      pageTimeoutMs: 15_000,
      maxCharsPerPage: 6_000,
      cacheDays: 30,
      negativeCacheDays: 7,
      userAgent: "FirecrawlAgent",
    },
    concurrency: {
      perWorker: num(env.WORKER_CONCURRENCY, 10),
      perWorkspace: num(env.WORKSPACE_CONCURRENCY, 5),
      firecrawl: num(env.FIRECRAWL_CONCURRENCY, 5),
      /** AI requests at once across all workers (LLM_CONCURRENCY, formerly ANTHROPIC_CONCURRENCY). */
      llm: num(pick("LLM_CONCURRENCY", "ANTHROPIC_CONCURRENCY"), 5),
      /**
       * AI requests per minute across all workers (LLM_RPM, formerly ANTHROPIC_RPM). Anthropic: the limit in
       * your Console. DeepSeek has no per-minute limit, only a concurrency limit; set this to keep spend steady.
       * Not set = no per-minute limit of ours.
       */
      llmPerMinute: pick("LLM_RPM", "ANTHROPIC_RPM") ? num(pick("LLM_RPM", "ANTHROPIC_RPM"), 0) || null : null,
    },
    /**
     * Deep research (search the contact's own professional content). OFF and hidden until the lawyer
     * and Anthropic have confirmed it (owner's decision, 2026-11-12). DEEP_RESEARCH_ENABLED=1 turns it on.
     */
    deep: { enabled: env.DEEP_RESEARCH_ENABLED === "1", searchResults: 5, pagesToRead: 2, maxFacts: 2 },
    retries: { jobRetryLimit: 3, jobRetryDelaySec: 20 },
    quality: { judgePassAvg: 3.5 },
    /** List price per Firecrawl credit (Standard plan $83 / 100k). Override for your plan. */
    firecrawlUsdPerCredit: num(env.FIRECRAWL_USD_PER_CREDIT, 0.00083),
    previewSize: 5,
  };
}

export type EngineConfig = ReturnType<typeof engineConfig>;
