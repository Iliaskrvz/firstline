// Test fixtures for the model bake-off: scripted models (no network) and a fake website reader.
import { anthropicCostEntry } from "./costs";
import type { StepModels } from "@/config/models";
import type { WebReader } from "./firecrawl";
import type { LLM } from "./llm";
import { FakeLLM } from "./llm-fake";
import type { TestSet } from "./lab";

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
const SIGN: Record<string, string> = { "claude-sonnet-5-5": "Hope this is useful.", "claude-haiku-5-5": "Hope this helps.", "claude-opus-5-5": "Hope this is useful today." };
const RANK: Record<string, number> = { "Hope this helps.": 0, "Hope this is useful.": 1, "Hope this is useful today.": 2 };
const signOf = (lines: string) => lines.split("\n").find((l) => l.startsWith("sign: "))!.slice(6);

export function scripted(models: StepModels): LLM {
  const fake = new FakeLLM();
  const usage = (i: number, o: number) => ({ input_tokens: i, output_tokens: o });
  return {
    provider: "anthropic",
    extractorId: models.extraction.model,
    extractFacts: async (input) => {
      const r = await fake.extractFacts(input);
      // Sonnet finds one more fact, which isn't on the page.
      const extra = models.extraction.model === "claude-sonnet-5-5" ? [{ id: `F${r.output.facts.length + 1}`, text: "Studio has 400 employees worldwide.", src: input.pages[0].url, tier: "A" as const }] : [];
      return { output: { facts: [...r.output.facts, ...extra] }, costs: [anthropicCostEntry("extract", models.extraction.model, usage(4000, 400))] };
    },
    write: async (input) => {
      const step = models.writer_pro;
      const r = await fake.write(input);
      r.output.slots.sign = SIGN[step.model];
      return { output: r.output, costs: [anthropicCostEntry("write", step.model, usage(2000, 600))] };
    },
    judge: async (input) => {
      const s = RANK[input.slots.sign] + 3;
      return {
        output: { relevance: s, specificity: s, value_clarity: s, cta_effort: s, sounds_human: s, would_reply: s, claims_supported: true, unsupported_claims: [] },
        costs: [anthropicCostEntry("judge", models.judge.model, usage(1200, 300))],
      };
    },
    compare: async (input) => {
      const a = RANK[signOf(input.a)];
      const b = RANK[signOf(input.b)];
      const isHaiku = models.testset_judge.model === "claude-haiku-5-5";
      // Opus picks the better version; Haiku always picks A (position bias).
      const winner = isHaiku ? "a" : a === b ? "tie" : a > b ? "a" : "b";
      return { output: { winner, reason: "scripted" }, costs: [anthropicCostEntry("compare", models.testset_judge.model, usage(1000, 200))] };
    },
    checkFacts: async (input) => {
      const r = await fake.checkFacts(input);
      return { output: r.output, costs: [anthropicCostEntry("fact_check", models.testset_judge.model, usage(5000, 300))] };
    },
    batch: {
      submit: async () => "batch_1",
      status: async () => "ended",
      results: async (_id, items) =>
        Promise.all(
          items.map(async (it) => {
            const r = await fake.write(it.input);
            r.output.slots.sign = SIGN[models.writer_economy.model];
            return { id: it.id, output: r.output, costs: [anthropicCostEntry("write", models.writer_economy.model, usage(2000, 600), { batch: true })] };
          }),
        ),
    },
  };
}

