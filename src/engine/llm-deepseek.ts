// DeepSeek implementation (LLM_PROVIDER=deepseek). OpenAI-compatible Chat Completions over fetch, JSON
// output mode, thinking off for our steps (config: effort "none"). Docs read 2026-11-13:
// api-docs.deepseek.com (base URL, auth, json_object mode, thinking, usage, balance, pricing).
//
// Engine rules kept: page text is wrapped as data, never instructions; every claim needs a fact ID;
// plan check, rule checks, judge and one rewrite happen in the pipeline as with any provider.
// Every answer is validated against our zod schemas; invalid or empty JSON is retried once, then the
// lead gets the free fallback (LLMInvalidOutputError).
// Privacy (owner's hard rule): the lead's email address, first name, last name and LinkedIn URL are
// never sent. The writer refers to the person neutrally; every request is scrubbed as a safety net.
// Prompt caching is automatic and prefix-based: the stable parts (rules, Sales Skill, JSON format, the
// customer's copy) come first, the lead and its facts last.
import type { z } from "zod";
import { DEEPSEEK_BASE_URL, type StepModel } from "@/config/models";
import type { EngineConfig } from "./config";
import { deepseekCostEntry, isDeepSeekPeak, type DeepSeekUsage } from "./costs";
import { Semaphore, type Gate } from "./limiter";
import {
  LLMInvalidOutputError,
  LLMRefusalError,
  LLMUnavailableError,
  type BatchResult,
  type BatchWriter,
  type CompareInput,
  type CompareOutput,
  type ExtractInput,
  type FactCheckInput,
  type JudgeInput,
  type LLM,
  type LLMResult,
  type WriteInput,
} from "./llm";
import { EXTRACT_PROMPT, EXTRACT_VERSION } from "./prompts/extract";
import { COMPARE_PROMPT, FACT_CHECK_PROMPT, JUDGE_PROMPT } from "./prompts/judge";
import { CompareSchema, FactCheckSchema, FactsSchema, JudgeSchema, sanitiseFacts, writerSchema, type FactCheckOutput } from "./schemas";
import { scrub } from "./privacy";
import { skillPrompt } from "./skills";
import { wrapPagesAsData } from "./clean";
import { CTA_TYPES, MOVES, type CostEntry, type Fact, type JudgeScores, type WriterOutput } from "./types";

// JSON mode needs the word "json" and an example of the shape in the prompt (DeepSeek docs).
const JSON_FACTS = `Answer with one json object only, in exactly this shape:
{"facts": [{"id": "F1", "text": "One fact in one sentence.", "src": "https://the-page-url-it-came-from/", "tier": "A"}]}`;
const JSON_WRITER = `Answer with one json object only, in exactly this shape (the slots object has exactly the slot keys listed below):
{"plan": {"angle": "F2", "pain": "what this means for them", "move": ["genuine_interest"], "cta_type": "soft_question"},
 "slots": {"opener": "the text you write for this slot"},
 "facts_used": ["F2"],
 "skill_version": "1.0"}
"move" uses only: ${MOVES.join(", ")}. "cta_type" is one of: ${CTA_TYPES.join(", ")}. Every claim about the company must come from a listed fact, and its id must be in "facts_used".
Refer to the person neutrally; never invent or guess their name. Variables like {{first_name}} are filled in later by the sender's software.`;
const JSON_JUDGE = `Answer with one json object only, in exactly this shape (scores are whole numbers 1-5):
{"relevance": 4, "specificity": 4, "value_clarity": 4, "cta_effort": 4, "sounds_human": 4, "would_reply": 4, "claims_supported": true, "unsupported_claims": []}`;
const JSON_COMPARE = `Answer with one json object only, in exactly this shape:
{"winner": "a", "reason": "one sentence"}
"winner" is "a", "b" or "tie".`;
const JSON_FACT_CHECK = `Answer with one json object only, in exactly this shape:
{"checks": [{"id": "F1", "verdict": "supported", "note": "short reason"}]}
"verdict" is "supported", "unsupported" or "wrong".`;

function factsBlock(facts: Fact[]) {
  return facts.map((f) => `${f.id} [tier ${f.tier}] ${f.text} (source: ${f.src === "csv" ? "lead list" : f.src})`).join("\n");
}

type FetchLike = (url: string, init: { method: string; headers: Record<string, string>; body?: string; signal?: AbortSignal }) => Promise<{ ok: boolean; status: number; text(): Promise<string> }>;

export type DeepSeekOptions = {
  gate?: Gate;
  fetch?: FetchLike;
  now?: () => Date;
  sleep?: (ms: number) => Promise<void>;
  baseUrl?: string;
};

type ChatResponse = {
  choices?: { message?: { content?: string | null }; finish_reason?: string }[];
  usage?: DeepSeekUsage & { prompt_tokens_details?: { cached_tokens?: number } };
};

export class DeepSeekLLM implements LLM {
  readonly provider = "deepseek" as const;
  readonly extractorId: string;
  private gate: Gate;
  private fetch: FetchLike;
  private now: () => Date;
  private sleep: (ms: number) => Promise<void>;
  private baseUrl: string;

  constructor(
    private config: EngineConfig,
    opts: DeepSeekOptions = {},
  ) {
    this.gate = opts.gate ?? new Semaphore(config.concurrency.llm);
    this.fetch = opts.fetch ?? ((url, init) => fetch(url, init));
    this.now = opts.now ?? (() => new Date());
    this.sleep = opts.sleep ?? ((ms) => new Promise((r) => setTimeout(r, ms)));
    this.baseUrl = opts.baseUrl ?? DEEPSEEK_BASE_URL;
    this.extractorId = `${config.models.extraction.model}:${EXTRACT_VERSION}`;
  }

  /** One HTTP call, retried on 429 / 5xx / network errors (3 tries). Auth and balance problems stop at once. */
  private async post(body: Record<string, unknown>): Promise<ChatResponse> {
    if (!this.config.deepseekApiKey) throw new LLMUnavailableError("DeepSeek key missing");
    let lastError: unknown;
    for (let attempt = 1; attempt <= 3; attempt++) {
      try {
        const res = await this.gate.run(() =>
          this.fetch(`${this.baseUrl}/chat/completions`, {
            method: "POST",
            headers: { "content-type": "application/json", authorization: `Bearer ${this.config.deepseekApiKey}` },
            body: JSON.stringify(body),
            signal: AbortSignal.timeout(300_000),
          }),
        );
        const text = await res.text();
        if (res.ok) return JSON.parse(text) as ChatResponse;
        if (res.status === 401) throw new LLMUnavailableError("DeepSeek key invalid");
        if (res.status === 402) throw new LLMUnavailableError("DeepSeek balance is empty: top up at platform.deepseek.com");
        if (res.status === 429 || res.status >= 500) {
          lastError = new Error(`DeepSeek ${res.status}`);
        } else {
          throw new Error(`DeepSeek ${res.status}: ${text.slice(0, 300)}`);
        }
      } catch (e) {
        if (e instanceof LLMUnavailableError || (e instanceof Error && /^DeepSeek 4\d\d:/.test(e.message))) throw e;
        lastError = e;
      }
      if (attempt < 3) await this.sleep(attempt * 3000);
    }
    throw lastError instanceof Error ? lastError : new Error("DeepSeek request failed");
  }

  /**
   * A JSON call with the step's model. `system` holds the stable parts (prompt caching), `user` the
   * per-lead part. Both are scrubbed of personal values. Invalid or empty JSON: one retry, then
   * LLMInvalidOutputError (the pipeline gives the free fallback).
   */
  private async json<T>(step: CostEntry["step"], sm: StepModel, schema: z.ZodType<T>, system: string, user: string, personal: string[], maxTokens: number): Promise<LLMResult<T>> {
    const costs: CostEntry[] = [];
    const messages = [
      { role: "system", content: scrub(system, personal) },
      { role: "user", content: scrub(user, personal) },
    ];
    let problem = "";
    for (let attempt = 1; attempt <= 2; attempt++) {
      const at = this.now();
      const body: Record<string, unknown> = {
        model: sm.model,
        messages: attempt === 1 ? messages : [...messages, { role: "user", content: `Your previous answer was not valid (${problem}). Answer again with the json object only, in the shape given.` }],
        response_format: { type: "json_object" },
        max_tokens: maxTokens,
        stream: false,
        ...(sm.effort === "none" ? { thinking: { type: "disabled" } } : { thinking: { type: "enabled" }, reasoning_effort: sm.effort === "low" ? "low" : "high" }),
      };
      const res = await this.post(body);
      const usage = res.usage ?? { completion_tokens: 0 };
      costs.push(deepseekCostEntry(step, sm.model, { ...usage, prompt_cache_hit_tokens: usage.prompt_cache_hit_tokens ?? usage.prompt_tokens_details?.cached_tokens ?? 0 }, at));
      const choice = res.choices?.[0];
      if (choice?.finish_reason === "content_filter") throw new LLMRefusalError();
      const content = choice?.message?.content?.trim() ?? "";
      if (!content) {
        problem = choice?.finish_reason === "length" ? "it was cut off" : "it was empty";
        continue;
      }
      let raw: unknown;
      try {
        raw = JSON.parse(content);
      } catch {
        problem = choice?.finish_reason === "length" ? "it was cut off" : "it wasn't valid json";
        continue;
      }
      const parsed = schema.safeParse(raw);
      if (parsed.success) return { output: parsed.data, costs };
      problem = `wrong shape: ${parsed.error.issues
        .slice(0, 3)
        .map((i) => `${i.path.join(".") || "root"} ${i.message}`)
        .join("; ")}`;
    }
    const err = new LLMInvalidOutputError(`DeepSeek returned invalid JSON twice (${problem})`);
    err.costs = costs;
    throw err;
  }

  async extractFacts(input: ExtractInput): Promise<LLMResult<{ facts: Fact[] }>> {
    const sm = this.config.models.extraction;
    const data = wrapPagesAsData(input.pages.map((p, i) => ({ id: `P${i + 1}`, ...p })));
    const res = await this.json("extract", sm, FactsSchema, `${EXTRACT_PROMPT}\n\n${JSON_FACTS}`, `Company: ${input.company ?? "unknown"} (${input.domain})\n\n${data}`, input.personal ?? [], 4000);
    return { output: { facts: sanitiseFacts(res.output.facts, input.pages.map((p) => p.url)) }, costs: res.costs };
  }

  /**
   * The writer request, split for prefix caching: (1) the skill prompt and the JSON format, the same for
   * every email of a skill version; (2) the customer's copy and style rules, the same for every lead of a
   * campaign; (3) the lead's company, role and facts, different every time. No names, ever.
   */
  writeRequest(input: WriteInput, opts: { batch?: boolean } = {}) {
    const step = input.writer === "lite" ? this.config.models.writer_lite : opts.batch ? this.config.models.writer_economy : this.config.models.writer_pro;
    const rules = input.styleRules;
    const campaign = [
      `Language: ${input.language}`,
      "",
      "The sender's email (only the [[slots]] are yours to write; {{variables}} are filled in later by the sender's software):",
      `Subject: ${input.template.subject}`,
      input.template.body,
      "",
      "Slots:",
      ...input.template.slots.map((s) => `- ${s.key}: ${s.instruction} (max ${s.max_words} words)`),
      `The "slots" object has exactly these keys: ${input.template.slots.map((s) => s.key).join(", ")}.`,
      "",
      "Style rules from the sender:",
      `- tone: ${rules.tone || "not set"}`,
      ...(rules.banned_phrases ?? []).map((b) => `- never use: ${b}`),
      ...(rules.extra_rules ?? []).map((r) => `- ${r}`),
      ...(input.examples.length ? ["", "Examples of emails that got replies:", ...input.examples] : []),
    ].join("\n");
    const user = [
      `Lead: a contact at ${input.lead.company ?? "this company"}${input.lead.title ? `, role: ${input.lead.title}` : ""}`,
      "",
      ...(input.followUp
        ? [
            `This is follow-up email ${input.followUp.stepNo} in the same thread. The lead hasn't replied to the first email:`,
            input.followUp.firstEmail,
            "",
            "Use a different fact or angle than the first email. Don't repeat its opener, and don't mention that they didn't reply.",
            "",
          ]
        : []),
      "Facts:",
      factsBlock(input.facts),
      ...(input.feedback?.length
        ? ["", "Your previous attempt failed these checks. Fix them:", ...input.feedback.map((f) => `- ${f}`), "", `Previous attempt: ${JSON.stringify(input.previous)}`]
        : []),
    ].join("\n");
    return { step, schema: writerSchema(input.template.slots.map((s) => s.key)), system: `${skillPrompt(input.skillVersion)}\n\n${JSON_WRITER}\n\n${campaign}`, user };
  }

  async write(input: WriteInput): Promise<LLMResult<WriterOutput>> {
    const r = this.writeRequest(input);
    return (await this.json("write", r.step, r.schema, r.system, r.user, input.personal ?? [], 4000)) as LLMResult<WriterOutput>;
  }

  private async writeEconomy(input: WriteInput): Promise<LLMResult<WriterOutput>> {
    const r = this.writeRequest(input, { batch: true });
    return (await this.json("write", r.step, r.schema, r.system, r.user, input.personal ?? [], 4000)) as LLMResult<WriterOutput>;
  }

  async judge(input: JudgeInput): Promise<LLMResult<JudgeScores>> {
    const user = `Language: ${input.language}\nReader's role: ${input.role ?? "unknown"}\n\nFacts:\n${factsBlock(input.facts)}\n\nPersonalised lines:\n${Object.entries(input.slots)
      .map(([k, v]) => `${k}: ${v}`)
      .join("\n")}\n\nFull email for context:\n${input.emailPreview}`;
    return this.json("judge", this.config.models.judge, JudgeSchema, `${JUDGE_PROMPT}\n\n${JSON_JUDGE}`, user, input.personal ?? [], 2000);
  }

  /** Quality Lab and bake-off comparisons: the test-set judge. Only slot lines are compared (no names in them). */
  async compare(input: CompareInput): Promise<LLMResult<CompareOutput>> {
    const user = `Language: ${input.language}\nReader's role: ${input.role ?? "unknown"}\n\nFacts:\n${factsBlock(input.facts)}\n\nVersion A:\n${input.a}\n\nVersion B:\n${input.b}`;
    return this.json("compare", this.config.models.testset_judge, CompareSchema, `${COMPARE_PROMPT}\n\n${JSON_COMPARE}`, user, [], 1500);
  }

  async checkFacts(input: FactCheckInput): Promise<LLMResult<FactCheckOutput>> {
    const data = wrapPagesAsData(input.pages.map((p, i) => ({ id: `P${i + 1}`, url: p.url, type: "web", markdown: p.markdown })));
    const user = `Company website: ${input.domain}\n\nFacts to check:\n${factsBlock(input.facts)}\n\n${data}`;
    return this.json("fact_check", this.config.models.testset_judge, FactCheckSchema, `${FACT_CHECK_PROMPT}\n\n${JSON_FACT_CHECK}`, user, [], 3000);
  }

  /**
   * Economy: no batch API at DeepSeek. A "batch" is held until off-peak hours (half price, times in
   * src/config/models.ts) and then written directly with the writer_economy model. Stateless, so it
   * survives a worker restart.
   */
  readonly batch: BatchWriter = {
    submit: async () => `offpeak-${this.now().getTime()}`,
    status: async () => (isDeepSeekPeak(this.now()) ? "in_progress" : "ended"),
    results: async (_batchId, items) =>
      Promise.all(
        items.map(async (it): Promise<BatchResult> => {
          try {
            return { id: it.id, ...(await this.writeEconomy(it.input)) };
          } catch (e) {
            if (e instanceof LLMUnavailableError) throw e;
            const costs = e instanceof LLMInvalidOutputError ? e.costs : [];
            return { id: it.id, costs, error: e instanceof LLMRefusalError ? e.message : `Write failed: ${(e as Error).message}` };
          }
        }),
      ),
  };
}
