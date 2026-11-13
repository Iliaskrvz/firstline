// Claude implementation. Which model does what (and at what effort) comes from
// src/config/models.ts through config.models. Structured outputs guarantee the
// JSON shape; the engine still validates the content.
// Prompt caching: the writer's skill prompt and campaign block are cached (see
// writeRequest). The extract and judge prompts are shorter than the 512-token
// minimum for these models, so their cache markers do nothing yet; they start
// working by themselves if those prompts grow.
import Anthropic from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import { betaZodOutputFormat } from "@anthropic-ai/sdk/helpers/beta/zod";
import type { z } from "zod";
import { HAS_SERVER_FALLBACK, type Effort, type StepModel } from "@/config/models";
import type { EngineConfig } from "./config";
import { anthropicCostEntry } from "./costs";
import { Semaphore, type Gate } from "./limiter";
import {
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
  type PersonInput,
  type WriteInput,
} from "./llm";
import { EXTRACT_PROMPT, EXTRACT_VERSION } from "./prompts/extract";
import { COMPARE_PROMPT, FACT_CHECK_PROMPT, JUDGE_PROMPT } from "./prompts/judge";
import { PERSON_PROMPT } from "./prompts/person";
import { CompareSchema, FactCheckSchema, type FactCheckOutput, PersonFactsSchema, type PersonFactsOutput, FactsSchema, JudgeSchema, sanitiseFacts, writerSchema } from "./schemas";
import { skillPrompt } from "./skills";
import { wrapPagesAsData } from "./clean";
import type { Fact, JudgeScores, WriterOutput } from "./types";

/** Claude has no "thinking off" on these models: "none" maps to its lowest effort. */
const claudeEffort = (e: Effort): "low" | "medium" | "high" => (e === "none" ? "low" : e);

const cachedSystem = (text: string) => [{ type: "text" as const, text, cache_control: { type: "ephemeral" as const } }];

function factsBlock(facts: Fact[]) {
  return facts.map((f) => `${f.id} [tier ${f.tier}] ${f.text} (source: ${f.src === "csv" ? "lead list" : f.src})`).join("\n");
}

export class AnthropicLLM implements LLM {
  readonly provider = "anthropic" as const;
  readonly extractorId: string;
  private client: Anthropic;
  private gate: Gate;

  /** gate: shared across workers in production (requests per minute + at once); in-process by default. */
  constructor(private config: EngineConfig, gate?: Gate) {
    this.client = new Anthropic({ apiKey: config.anthropicApiKey!, maxRetries: 4, timeout: 120_000 });
    this.gate = gate ?? new Semaphore(config.concurrency.llm);
    this.extractorId = `${config.models.extraction.model}:${EXTRACT_VERSION}`;
  }

  /**
   * One structured-output call with the step's model and effort. Sonnet and Opus get the server-side
   * refusal fallback (routes a declined request to another model); Haiku has none.
   */
  private async parse(
    sm: StepModel,
    schema: z.ZodType,
    req: { max_tokens: number; system: Anthropic.TextBlockParam[]; messages: Anthropic.MessageParam[] },
  ): Promise<{ output: unknown; stop: string | null; usage: Anthropic.Usage }> {
    if (HAS_SERVER_FALLBACK[sm.model]) {
      const res = await this.call(() =>
        this.client.beta.messages.parse({
          model: sm.model,
          max_tokens: req.max_tokens,
          betas: ["server-side-fallback-2026-07-01"],
          fallbacks: "default",
          system: req.system,
          output_config: { format: betaZodOutputFormat(schema), effort: claudeEffort(sm.effort) },
          messages: req.messages,
        }),
      );
      return { output: res.parsed_output, stop: res.stop_reason, usage: res.usage as unknown as Anthropic.Usage };
    }
    const res = await this.call(() =>
      this.client.messages.parse({
        model: sm.model,
        max_tokens: req.max_tokens,
        system: req.system,
        output_config: { format: zodOutputFormat(schema), effort: claudeEffort(sm.effort) },
        messages: req.messages,
      }),
    );
    return { output: res.parsed_output, stop: res.stop_reason, usage: res.usage };
  }

  private async call<T>(fn: () => Promise<T>): Promise<T> {
    try {
      return await this.gate.run(fn);
    } catch (e) {
      if (e instanceof Anthropic.AuthenticationError) throw new LLMUnavailableError("Anthropic key invalid");
      if (e instanceof Anthropic.PermissionDeniedError) throw new LLMUnavailableError("Anthropic key has no access to this model");
      throw e; // 429/5xx already retried by the SDK; the job queue retries the rest
    }
  }

  async extractFacts(input: ExtractInput): Promise<LLMResult<{ facts: Fact[] }>> {
    const sm = this.config.models.extraction;
    const data = wrapPagesAsData(input.pages.map((p, i) => ({ id: `P${i + 1}`, ...p })));
    const res = await this.parse(sm, FactsSchema, {
      max_tokens: 4000,
      system: cachedSystem(EXTRACT_PROMPT),
      messages: [{ role: "user", content: `Company: ${input.company ?? "unknown"} (${input.domain})\n\n${data}` }],
    });
    if (res.stop === "refusal") throw new LLMRefusalError();
    const parsed = res.output as { facts: { id: string; text: string; src: string; tier: string }[] } | null;
    const facts = sanitiseFacts(parsed?.facts ?? [], input.pages.map((p) => p.url));
    return { output: { facts }, costs: [anthropicCostEntry("extract", sm.model, res.usage)] };
  }

  /**
   * The writer request, split for prompt caching (a prefix match, system before messages):
   *   1. the skill prompt: the same for every email of a skill version;
   *   2. the campaign block (template, slots, style rules, language): the same for every lead of a campaign;
   *   3. the lead and its facts, in the user message: different every time.
   * Both system blocks carry a cache breakpoint, so each lead after the first reads 1 and 2 at the cache price.
   */
  writeRequest(input: WriteInput, opts: { batch?: boolean } = {}) {
    const step = input.writer === "lite" ? this.config.models.writer_lite : opts.batch ? this.config.models.writer_economy : this.config.models.writer_pro;
    const model = step.model;
    const rules = input.styleRules;
    const campaign = [
      `Language: ${input.language}`,
      "",
      "The sender's email (only the [[slots]] are yours to write):",
      `Subject: ${input.template.subject}`,
      input.template.body,
      "",
      "Slots:",
      ...input.template.slots.map((s) => `- ${s.key}: ${s.instruction} (max ${s.max_words} words)`),
      "",
      "Style rules from the sender:",
      `- tone: ${rules.tone || "not set"}`,
      ...(rules.banned_phrases ?? []).map((b) => `- never use: ${b}`),
      ...(rules.extra_rules ?? []).map((r) => `- ${r}`),
      ...(input.examples.length ? ["", "Examples of emails that got replies:", ...input.examples] : []),
    ].join("\n");
    const user = [
      `Lead: ${input.lead.first_name ?? "?"} at ${input.lead.company ?? "?"}${input.lead.title ? `, role: ${input.lead.title}` : ""}`,
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
      ...(input.facts.some((f) => f.tier === "D")
        ? [
            "",
            "Facts P1/P2 (tier D) are the contact's own public work for their company (an article, talk, podcast or company news). If you use one, mention it the way a peer would (\"your talk on …\", \"your piece about …\"), never say how you found it, never add anything about them as a person, and use at most one.",
          ]
        : []),
      ...(input.feedback?.length
        ? ["", "Your previous attempt failed these checks. Fix them:", ...input.feedback.map((f) => `- ${f}`), "", `Previous attempt: ${JSON.stringify(input.previous)}`]
        : []),
    ].join("\n");
    return {
      model,
      step,
      schema: writerSchema(input.template.slots.map((s) => s.key)),
      system: [...cachedSystem(skillPrompt(input.skillVersion)), ...cachedSystem(campaign)],
      messages: [{ role: "user" as const, content: user }] satisfies Anthropic.MessageParam[],
    };
  }

  async write(input: WriteInput): Promise<LLMResult<WriterOutput>> {
    const { step, schema, system, messages } = this.writeRequest(input);
    const res = await this.parse(step, schema, { max_tokens: 8000, system, messages });
    if (res.stop === "refusal") throw new LLMRefusalError();
    const output = res.output as WriterOutput | null;
    if (!output) throw new Error(`Writer returned no valid JSON (stop_reason: ${res.stop})`);
    return { output, costs: [anthropicCostEntry("write", step.model, res.usage)] };
  }

  /**
   * Economy mode: the same writer requests through the Message Batches API (50% off, results
   * usually within the hour, at most 24 h). Batches can't use the server-side refusal fallback,
   * so a declined request comes back as an error and that lead is written directly instead.
   */
  readonly batch: BatchWriter = {
    submit: async (items) => {
      const batch = await this.call(() =>
        this.client.messages.batches.create({
          requests: items.map((it) => {
            const { model, step, schema, system, messages } = this.writeRequest(it.input, { batch: true });
            return {
              custom_id: it.id,
              params: { model, max_tokens: 8000, system, output_config: { format: zodOutputFormat(schema), effort: claudeEffort(step.effort) }, messages },
            };
          }),
        }),
      );
      return batch.id;
    },
    status: async (batchId) => {
      const b = await this.call(() => this.client.messages.batches.retrieve(batchId));
      return b.processing_status === "ended" ? "ended" : "in_progress";
    },
    results: async (batchId, items) => {
      const byId = new Map(items.map((i) => [i.id, i.input]));
      const out: BatchResult[] = [];
      for await (const r of await this.call(() => this.client.messages.batches.results(batchId))) {
        const input = byId.get(r.custom_id);
        if (!input) continue;
        if (r.result.type !== "succeeded") {
          out.push({ id: r.custom_id, costs: [], error: `Batch request ${r.result.type}` });
          continue;
        }
        const msg = r.result.message;
        const { model, schema } = this.writeRequest(input, { batch: true });
        const costs = [anthropicCostEntry("write", model, msg.usage, { batch: true })];
        const text = msg.content.find((b): b is Anthropic.TextBlock => b.type === "text")?.text;
        let parsed: WriterOutput | null = null;
        try {
          parsed = text ? (schema.parse(JSON.parse(text)) as WriterOutput) : null;
        } catch {
          parsed = null;
        }
        if (msg.stop_reason === "refusal" || !parsed) out.push({ id: r.custom_id, costs, error: msg.stop_reason === "refusal" ? "The model declined" : "No valid JSON" });
        else out.push({ id: r.custom_id, costs, output: parsed });
      }
      return out;
    },
  };

  async personFacts(input: PersonInput): Promise<LLMResult<PersonFactsOutput>> {
    const sm = this.config.models.extraction;
    const data = wrapPagesAsData(input.pages.map((p, i) => ({ id: `W${i + 1}`, url: p.url, type: "web", markdown: p.markdown.slice(0, 8000) })));
    const p = input.person;
    const res = await this.parse(sm, PersonFactsSchema, {
      max_tokens: 1500,
      system: cachedSystem(PERSON_PROMPT),
      messages: [
        {
          role: "user",
          content: `Contact: ${p.first_name} ${p.last_name}\nCompany: ${p.company ?? "unknown"} (${p.domain})\nJob title: ${p.title ?? "unknown"}\n\n${data}`,
        },
      ],
    });
    if (res.stop === "refusal") throw new LLMRefusalError();
    if (!res.output) throw new Error("Person check returned no valid JSON");
    return { output: res.output as PersonFactsOutput, costs: [anthropicCostEntry("search", sm.model, res.usage)] };
  }

  /** Quality Lab and bake-off comparisons: the test-set judge (Opus, lowest effort, by default). */
  async compare(input: CompareInput): Promise<LLMResult<CompareOutput>> {
    const sm = this.config.models.testset_judge;
    const res = await this.parse(sm, CompareSchema, {
      max_tokens: 4000,
      system: cachedSystem(COMPARE_PROMPT),
      messages: [
        {
          role: "user",
          content: `Language: ${input.language}\nReader's role: ${input.role ?? "unknown"}\n\nFacts:\n${factsBlock(input.facts)}\n\nVersion A:\n${input.a}\n\nVersion B:\n${input.b}`,
        },
      ],
    });
    if (res.stop === "refusal") throw new LLMRefusalError();
    if (!res.output) throw new Error("Compare returned no valid JSON");
    return { output: res.output as CompareOutput, costs: [anthropicCostEntry("compare", sm.model, res.usage)] };
  }

  /** The judge that scores every email before the customer sees it. */
  async judge(input: JudgeInput): Promise<LLMResult<JudgeScores>> {
    const sm = this.config.models.judge;
    const res = await this.parse(sm, JudgeSchema, {
      max_tokens: 4000,
      system: cachedSystem(JUDGE_PROMPT),
      messages: [
        {
          role: "user",
          content: `Language: ${input.language}\nReader's role: ${input.role ?? "unknown"}\n\nFacts:\n${factsBlock(input.facts)}\n\nPersonalised lines:\n${Object.entries(input.slots)
            .map(([k, v]) => `${k}: ${v}`)
            .join("\n")}\n\nFull email for context:\n${input.emailPreview}`,
        },
      ],
    });
    if (res.stop === "refusal") throw new LLMRefusalError();
    if (!res.output) throw new Error("Judge returned no valid JSON");
    return { output: res.output as JudgeScores, costs: [anthropicCostEntry("judge", sm.model, res.usage)] };
  }

  /** Bake-off: the test-set judge checks extracted facts against the pages they cite. */
  async checkFacts(input: FactCheckInput): Promise<LLMResult<FactCheckOutput>> {
    const sm = this.config.models.testset_judge;
    const data = wrapPagesAsData(input.pages.map((p, i) => ({ id: `P${i + 1}`, url: p.url, type: "web", markdown: p.markdown })));
    const res = await this.parse(sm, FactCheckSchema, {
      max_tokens: 4000,
      system: cachedSystem(FACT_CHECK_PROMPT),
      messages: [{ role: "user", content: `Company website: ${input.domain}\n\nFacts to check:\n${factsBlock(input.facts)}\n\n${data}` }],
    });
    if (res.stop === "refusal") throw new LLMRefusalError();
    if (!res.output) throw new Error("Fact check returned no valid JSON");
    return { output: res.output as FactCheckOutput, costs: [anthropicCostEntry("fact_check", sm.model, res.usage)] };
  }
}
