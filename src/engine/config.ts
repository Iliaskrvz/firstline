// Engine settings. Everything tunable lives here; read from env with safe defaults.
import { MODELS } from "@/lib/config/models";

const num = (v: string | undefined, d: number) => (v && Number.isFinite(Number(v)) ? Number(v) : d);

export type LlmProvider = "fake" | "anthropic";

export function engineConfig(env: Record<string, string | undefined> = process.env) {
  const provider: LlmProvider = env.LLM_PROVIDER === "anthropic" ? "anthropic" : "fake";
  return {
    /** "fake" = realistic test output, no AI used. Set LLM_PROVIDER=anthropic to use Claude. */
    llmProvider: provider,
    anthropicApiKey: env.ANTHROPIC_API_KEY?.trim() || null,
    firecrawlApiKey: env.FIRECRAWL_API_KEY?.trim() || null,
    models: { extract: MODELS.fast, judge: MODELS.fast, writerPro: MODELS.writer, writerLite: MODELS.fast },
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
      anthropic: num(env.ANTHROPIC_CONCURRENCY, 5),
      /** Requests per minute to Anthropic across all workers (your Anthropic tier's limit, a bit under). */
      anthropicPerMinute: num(env.ANTHROPIC_RPM, 45),
    },
    retries: { jobRetryLimit: 3, jobRetryDelaySec: 20 },
    quality: { judgePassAvg: 3.5 },
    /** List price per Firecrawl credit (Standard plan $83 / 100k). Override for your plan. */
    firecrawlUsdPerCredit: num(env.FIRECRAWL_USD_PER_CREDIT, 0.00083),
    previewSize: 5,
  };
}

export type EngineConfig = ReturnType<typeof engineConfig>;
