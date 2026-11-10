// Claude implementation. Haiku extracts facts and judges; Sonnet (Pro) or Haiku
// (Lite) writes. Static system prompts are cached. Structured outputs guarantee
// the JSON shape; the engine still validates the content.
import Anthropic from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import { betaZodOutputFormat } from "@anthropic-ai/sdk/helpers/beta/zod";
import type { EngineConfig } from "./config";
import { anthropicCostEntry } from "./costs";
import { Semaphore } from "./limiter";
import { LLMRefusalError, LLMUnavailableError, type ExtractInput, type JudgeInput, type LLM, type LLMResult, type WriteInput } from "./llm";
import { EXTRACT_PROMPT, EXTRACT_VERSION } from "./prompts/extract";
import { JUDGE_PROMPT } from "./prompts/judge";
import { SKILL_V1_PROMPT } from "./prompts/skill-v1";
import { FactsSchema, JudgeSchema, sanitiseFacts, writerSchema } from "./schemas";
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
  private gate: Semaphore;

  constructor(private config: EngineConfig) {
    this.client = new Anthropic({ apiKey: config.anthropicApiKey!, maxRetries: 4, timeout: 120_000 });
    this.gate = new Semaphore(config.concurrency.anthropic);
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

  async write(input: WriteInput): Promise<LLMResult<WriterOutput>> {
    const model = input.writer === "lite" ? this.config.models.writerLite : this.config.models.writerPro;
    const schema = writerSchema(input.template.slots.map((s) => s.key));
    const rules = input.styleRules;
    const user = [
      `Language: ${input.language}`,
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
      "",
      "Facts:",
      factsBlock(input.facts),
      ...(input.examples.length ? ["", "Examples of emails that got replies:", ...input.examples] : []),
      ...(input.feedback?.length
        ? ["", "Your previous attempt failed these checks. Fix them:", ...input.feedback.map((f) => `- ${f}`), "", `Previous attempt: ${JSON.stringify(input.previous)}`]
        : []),
    ].join("\n");

    const messages: Anthropic.MessageParam[] = [{ role: "user", content: user }];
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
          system: cachedSystem(SKILL_V1_PROMPT),
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
          system: cachedSystem(SKILL_V1_PROMPT),
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
