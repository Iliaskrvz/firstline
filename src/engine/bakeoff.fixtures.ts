// Test fixtures for the model bake-off: scripted models (no network) and a fake website reader.
import { modelCostEntry } from "./costs";
import type { StepModels } from "@/config/models";
import type { WebReader } from "./firecrawl";
import type { LLM } from "./llm";
import { FakeLLM } from "./llm-fake";
import type { TestSet } from "./lab";
import type { CostEntry } from "./types";

export const SITE = (d: string): Record<string, string> => ({
  [`https://${d}/`]: `# ${d}\n\nWe design packaging for independent food brands across the Netherlands since 2012. Our team of twelve designers works from Utrecht for clients in five countries.`,
  [`https://${d}/nieuws`]: `# Nieuws\n\nWe opened a second studio in Rotterdam this spring to work closer to our clients in the port area.`,
});
export const reader: WebReader = {
  robots: async () => null,
  map: async (u) => ({ links: Object.keys(SITE(new URL(u).hostname)).map((url) => ({ url })), credits: 1 }),
  scrape: async (url) => {
    const md = SITE(new URL(url).hostname)[url];
    return { markdown: md ?? "", statusCode: md ? 200 : 404, credits: 1 };
  },
};

export const set = (id: string, n: number, body: string): TestSet => ({
  id,
  name: id,
  template: { subject: "Idea for {{company}}", body },
  leads: Array.from({ length: n }, (_, i) => ({ first_name: "Anna", company: `Studio ${id}${i}`, title: "Founder", domain: `studio-${id}${i}.nl` })),
});
export const EN = set("en", 4, "Hi {{first_name}},\n\n[[opener · something specific from their website · 25]]\n\n[[sign · a short closing line · 6]]\n\nBest");
export const NL = set("nl", 3, "Hoi {{first_name}},\n\n[[opener · iets specifieks van hun website · 25]]\n\n[[sign · een korte afsluiter · 6]]\n\nGroet");

// Each writer model leaves its own closing line, so the scripted judges can tell the versions apart.
const SIGN: Record<string, string> = {
  "claude-sonnet-5-5": "Hope this is useful.",
  "claude-haiku-5-5": "Hope this helps.",
  "claude-opus-5-5": "Hope this is useful today.",
  "deepseek-v4-pro": "Hope this is useful.",
  "deepseek-flash": "Hope this helps.",
};
const RANK: Record<string, number> = { "Hope this helps.": 0, "Hope this is useful.": 1, "Hope this is useful today.": 2 };
const signOf = (lines: string) => lines.split("\n").find((l) => l.startsWith("sign: "))!.slice(6);
/** The cheap judges (always pick A: position bias) and the bigger extractors (one extra fact not on the page). */
const CHEAP = new Set(["claude-haiku-5-5", "deepseek-flash"]);
const BIG = new Set(["claude-sonnet-5-5", "deepseek-v4-pro"]);

/** A Monday in DeepSeek's peak hours, and a Saturday (off-peak), so DeepSeek costs are predictable. */
export const PEAK = new Date("2026-11-16T02:00:00Z");
export const OFF_PEAK = new Date("2026-11-14T12:00:00Z");

export function scripted(models: StepModels): LLM {
  const fake = new FakeLLM();
  const cost = (step: CostEntry["step"], model: string, input: number, output: number, batch = false) =>
    modelCostEntry(step, model, { input, output }, { batch, at: batch ? OFF_PEAK : PEAK });
  return {
    provider: models.extraction.model.startsWith("deepseek-") ? "deepseek" : "anthropic",
    extractorId: models.extraction.model,
    extractFacts: async (input) => {
      const r = await fake.extractFacts(input);
      const extra = BIG.has(models.extraction.model) ? [{ id: `F${r.output.facts.length + 1}`, text: "Studio has 400 employees worldwide.", src: input.pages[0].url, tier: "A" as const }] : [];
      return { output: { facts: [...r.output.facts, ...extra] }, costs: [cost("extract", models.extraction.model, 4000, 400)] };
    },
    write: async (input) => {
      const step = models.writer_pro;
      const r = await fake.write(input);
      r.output.slots.sign = SIGN[step.model];
      return { output: r.output, costs: [cost("write", step.model, 2000, 600)] };
    },
    judge: async (input) => {
      const s = RANK[input.slots.sign] + 3;
      return {
        output: { relevance: s, specificity: s, value_clarity: s, cta_effort: s, sounds_human: s, would_reply: s, claims_supported: true, unsupported_claims: [] },
        costs: [cost("judge", models.judge.model, 1200, 300)],
      };
    },
    compare: async (input) => {
      const a = RANK[signOf(input.a)];
      const b = RANK[signOf(input.b)];
      const winner = CHEAP.has(models.testset_judge.model) ? "a" : a === b ? "tie" : a > b ? "a" : "b";
      return { output: { winner, reason: "scripted" }, costs: [cost("compare", models.testset_judge.model, 1000, 200)] };
    },
    checkFacts: async (input) => {
      const r = await fake.checkFacts(input);
      return { output: r.output, costs: [cost("fact_check", models.testset_judge.model, 5000, 300)] };
    },
    batch: {
      submit: async () => "batch_1",
      status: async () => "ended",
      results: async (_id, items) =>
        Promise.all(
          items.map(async (it) => {
            const r = await fake.write(it.input);
            r.output.slots.sign = SIGN[models.writer_economy.model];
            return { id: it.id, output: r.output, costs: [cost("write", models.writer_economy.model, 2000, 600, true)] };
          }),
        ),
    },
  };
}
