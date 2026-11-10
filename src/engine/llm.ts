// The engine's only door to a language model. Two implementations:
//   - FakeLLM: realistic output built from the real page text. No AI used, $0.
//   - AnthropicLLM: Claude (Haiku for facts + judge, Sonnet/Haiku for writing).
// Switch with LLM_PROVIDER=anthropic (plus ANTHROPIC_API_KEY). Nothing else changes.
import type { StyleRules } from "@/lib/types";
import type { Slot } from "@/lib/template";
import type { EngineConfig } from "./config";
import type { CostEntry, Fact, JudgeScores, Language, WriterOutput } from "./types";

export type LLMResult<T> = { output: T; costs: CostEntry[] };

export type ExtractInput = {
  company: string | null;
  domain: string;
  pages: { url: string; type: string; markdown: string }[];
};

export type WriteInput = {
  writer: "pro" | "lite";
  skillVersion: string;
  language: Language;
  template: { subject: string; body: string; slots: Slot[] };
  styleRules: StyleRules;
  facts: Fact[];
  lead: { first_name: string | null; company: string | null; title: string | null; linkedin_headline: string | null };
  examples: string[];
  /** Set on the one rewrite: why the first attempt failed. */
  feedback?: string[];
  previous?: WriterOutput;
  /** Set when writing a follow-up in the same thread. */
  followUp?: { stepNo: number; firstEmail: string };
};

export type JudgeInput = { language: Language; slots: Record<string, string>; facts: Fact[]; emailPreview: string; role: string | null };

/** Two versions of the personalised lines for the same lead, for the Quality Lab. */
export type CompareInput = { language: Language; facts: Fact[]; role: string | null; a: string; b: string };
export type CompareOutput = { winner: "a" | "b" | "tie"; reason: string };

/** Economy mode (§9): the first write of each lead goes through a batch at half price. */
export type BatchItem = { id: string; input: WriteInput };
export type BatchResult = { id: string; output?: WriterOutput; costs: CostEntry[]; error?: string };
export interface BatchWriter {
  /** Returns the provider's batch id. */
  submit(items: BatchItem[]): Promise<string>;
  status(batchId: string): Promise<"in_progress" | "ended">;
  /** One result per item that has one; items are passed again so results can be validated against their slots. */
  results(batchId: string, items: BatchItem[]): Promise<BatchResult[]>;
}

export interface LLM {
  readonly provider: "fake" | "anthropic";
  /** Cache key part: facts from different extractors are never mixed. */
  readonly extractorId: string;
  extractFacts(input: ExtractInput): Promise<LLMResult<{ facts: Fact[] }>>;
  write(input: WriteInput): Promise<LLMResult<WriterOutput>>;
  judge(input: JudgeInput): Promise<LLMResult<JudgeScores>>;
  /** Quality Lab: which of two versions is the better cold-email personalisation? */
  compare?(input: CompareInput): Promise<LLMResult<CompareOutput>>;
  /** Present when the provider can write in batches (Economy mode). */
  readonly batch?: BatchWriter;
}

/** The AI step can't run (missing/invalid key). Not retried; shown on the lead. */
export class LLMUnavailableError extends Error {
  constructor(public reason: string) {
    super(reason);
    this.name = "LLMUnavailableError";
  }
}

/** The model declined (stop_reason "refusal"). The lead falls back, 0 credits. */
export class LLMRefusalError extends Error {
  constructor(message = "The model declined") {
    super(message);
    this.name = "LLMRefusalError";
  }
}

/** Stands in when LLM_PROVIDER=anthropic but no key is set: every AI step reports it clearly. */
export class MissingKeyLLM implements LLM {
  readonly provider = "anthropic" as const;
  readonly extractorId = "unavailable";
  private fail(): never {
    throw new LLMUnavailableError("Anthropic key missing");
  }
  async extractFacts(): Promise<never> {
    this.fail();
  }
  async write(): Promise<never> {
    this.fail();
  }
  async judge(): Promise<never> {
    this.fail();
  }
}

export async function selectLLM(config: EngineConfig): Promise<LLM> {
  if (config.llmProvider === "fake") {
    const { FakeLLM } = await import("./llm-fake");
    return new FakeLLM();
  }
  if (!config.anthropicApiKey) return new MissingKeyLLM();
  const { AnthropicLLM } = await import("./llm-anthropic");
  return new AnthropicLLM(config);
}
