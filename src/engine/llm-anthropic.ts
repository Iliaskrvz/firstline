// Claude implementation. Haiku extracts facts and judges; Sonnet (Pro) or Haiku
// (Lite) writes. Structured outputs guarantee the JSON shape; the engine still
// validates the content.
// Prompt caching: the writer's skill prompt and campaign block are cached (see
// writeRequest). The extract and judge prompts are shorter than the 512-token
// minimum for these models, so their cache markers do nothing yet; they start
// working by themselves if those prompts grow.
import Anthropic from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import { betaZodOutputFormat } from "@anthropic-ai/sdk/helpers/beta/zod";
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
  type JudgeInput,
  type LLM,
  type LLMResult,
  type WriteInput,
} from "./llm";
import { EXTRACT_PROMPT, EXTRACT_VERSION } from "./prompts/extract";
import { COMPARE_PROMPT, JUDGE_PROMPT } from "./prompts/judge";
import { CompareSchema, FactsSchema, JudgeSchema, sanitiseFacts, writerSchema } from "./schemas";
import { skillPrompt } from "./skills";
import { wrapPagesAsData } from "./clean";
import type { Fact, JudgeScores, WriterOutput } from "./types";

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
    this.gate = gate ?? new Semaphore(config.concurrency.anthropic);
    this.extractorId = `${config.models.extract}:${EXTRACT_VERSION}`;
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
    const model = this.config.models.extract;
    const data = wrapPagesAsData(input.pages.map((p, i) => ({ id: `P${i + 1}`, ...p })));
    const res = await this.call(() =>
      this.client.messages.parse({
        model,
        max_tokens: 4000,
        system: cachedSystem(EXTRACT_PROMPT),
        output_config: { format: zodOutputFormat(FactsSchema), effort: "low" },
        messages: [{ role: "user", content: `Company: ${input.company ?? "unknown"} (${input.domain})\n\n${data}` }],
      }),
    );
    if (res.stop_reason === "refusal") throw new LLMRefusalError();
    const facts = sanitiseFacts(res.parsed_output?.facts ?? [], input.pages.map((p) => p.url));
    return { output: { facts }, costs: [anthropicCostEntry("extract", model, res.usage)] };
  }

  /**
   * The writer request, split for prompt caching (a prefix match, system before messages):
   *   1. the skill prompt: the same for every email of a skill version;
   *   2. the campaign block (template, slots, style rules, language): the same for every lead of a campaign;
   *   3. the lead and its facts, in the user message: different every time.
   * Both system blocks carry a cache breakpoint, so each lead after the first reads 1 and 2 at the cache price.
   */
  writeRequest(input: WriteInput) {
    const model = input.writer === "lite" ? this.config.models.writerLite : this.config.models.writerPro;
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
      ...(input.feedback?.length
        ? ["", "Your previous attempt failed these checks. Fix them:", ...input.feedback.map((f) => `- ${f}`), "", `Previous attempt: ${JSON.stringify(input.previous)}`]
        : []),
    ].join("\n");
    return {
      model,
      schema: writerSchema(input.template.slots.map((s) => s.key)),
      system: [...cachedSystem(skillPrompt(input.skillVersion)), ...cachedSystem(campaign)],
      messages: [{ role: "user" as const, content: user }] satisfies Anthropic.MessageParam[],
    };
  }

  async write(input: WriteInput): Promise<LLMResult<WriterOutput>> {
    const { model, schema, system, messages } = this.writeRequest(input);
    let output: WriterOutput | null;
    let stop: string | null;
    let usage;
    if (model === this.config.models.writerPro) {
      // Sonnet: server-side refusal fallback (routes a declined request to another model).
      const res = await this.call(() =>
        this.client.beta.messages.parse({
          model,
          max_tokens: 8000,
          betas: ["server-side-fallback-2026-07-01"],
          fallbacks: "default",
          system,
          output_config: { format: betaZodOutputFormat(schema), effort: "medium" },
          messages,
        }),
      );
      output = res.parsed_output as WriterOutput | null;
      stop = res.stop_reason;
      usage = res.usage;
    } else {
      const res = await this.call(() =>
        this.client.messages.parse({
          model,
          max_tokens: 8000,
          system,
          output_config: { format: zodOutputFormat(schema), effort: "medium" },
          messages,
        }),
      );
      output = res.parsed_output as WriterOutput | null;
      stop = res.stop_reason;
      usage = res.usage;
    }
    if (stop === "refusal") throw new LLMRefusalError();
    if (!output) throw new Error(`Writer returned no valid JSON (stop_reason: ${stop})`);
    return { output, costs: [anthropicCostEntry("write", model, usage)] };
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
            const { model, schema, system, messages } = this.writeRequest(it.input);
            return {
              custom_id: it.id,
              params: { model, max_tokens: 8000, system, output_config: { format: zodOutputFormat(schema), effort: "medium" as const }, messages },
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
        const { model, schema } = this.writeRequest(input);
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

  async compare(input: CompareInput): Promise<LLMResult<CompareOutput>> {
    const model = this.config.models.judge;
    const res = await this.call(() =>
      this.client.messages.parse({
        model,
        max_tokens: 2000,
        system: cachedSystem(COMPARE_PROMPT),
        output_config: { format: zodOutputFormat(CompareSchema), effort: "low" },
        messages: [
          {
            role: "user",
            content: `Language: ${input.language}\nReader's role: ${input.role ?? "unknown"}\n\nFacts:\n${factsBlock(input.facts)}\n\nVersion A:\n${input.a}\n\nVersion B:\n${input.b}`,
          },
        ],
      }),
    );
    if (res.stop_reason === "refusal") throw new LLMRefusalError();
    if (!res.parsed_output) throw new Error("Compare returned no valid JSON");
    return { output: res.parsed_output, costs: [anthropicCostEntry("judge", model, res.usage)] };
  }

  async judge(input: JudgeInput): Promise<LLMResult<JudgeScores>> {
    const model = this.config.models.judge;
    const res = await this.call(() =>
      this.client.messages.parse({
        model,
        max_tokens: 3000,
        system: cachedSystem(JUDGE_PROMPT),
        output_config: { format: zodOutputFormat(JudgeSchema), effort: "low" },
        messages: [
          {
            role: "user",
            content: `Language: ${input.language}\nReader's role: ${input.role ?? "unknown"}\n\nFacts:\n${factsBlock(input.facts)}\n\nPersonalised lines:\n${Object.entries(input.slots)
              .map(([k, v]) => `${k}: ${v}`)
              .join("\n")}\n\nFull email for context:\n${input.emailPreview}`,
          },
        ],
      }),
    );
    if (res.stop_reason === "refusal") throw new LLMRefusalError();
    if (!res.parsed_output) throw new Error("Judge returned no valid JSON");
    return { output: res.parsed_output, costs: [anthropicCostEntry("judge", model, res.usage)] };
  }
}
