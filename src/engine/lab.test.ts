import { describe, expect, it } from "vitest";
import { engineConfig } from "./config";
import type { WebReader } from "./firecrawl";
import { evalLead, runEval, summarise, type LeadResult, type TestSet } from "./lab";
import type { LLM } from "./llm";
import { FakeLLM } from "./llm-fake";
import { MemoryStore } from "./store";

const site: WebReader = {
  robots: async () => null,
  map: async () => ({ links: [{ url: "https://acme.nl/over-ons" }], credits: 1 }),
  scrape: async (url) =>
    url.includes("empty.nl")
      ? { markdown: "", statusCode: 200, credits: 1 }
      : {
          markdown:
            "# Over ons\n\nAcme Studio designs packaging for independent food brands across the Netherlands. Since 2012 the team has grown to twelve designers. We opened a second studio in Rotterdam this autumn for our growing client base.",
          statusCode: 200,
          credits: 1,
        },
};
const set: TestSet = {
  id: "t1",
  name: "Test",
  template: { subject: "Idea for {{company}}", body: "Hi {{first_name}},\n\n[[opener · something specific from their website · 25]]\n\nBest", style_rules: { language: "en" } },
  leads: [{ first_name: "Anna", company: "Acme", title: "Founder", domain: "acme.nl" }],
};
const deps = (llm: LLM = new FakeLLM(), random = () => 0.9) => ({ store: new MemoryStore(), reader: site, llm, config: engineConfig({}), random });

/** A fake that prefers whatever text contains "PICK ME", wherever it is shown. */
function picky(): LLM {
  const fake = new FakeLLM();
  return {
    provider: "fake",
    extractorId: "fake",
    extractFacts: (i) => fake.extractFacts(i),
    judge: () => fake.judge(),
    write: async (input) => {
      const r = await fake.write(input);
      if (input.skillVersion === "2.0") r.output.slots.opener = `${r.output.slots.opener} PICK ME`;
      return r;
    },
    compare: async (i) => ({ output: { winner: i.a.includes("PICK ME") ? "a" : i.b.includes("PICK ME") ? "b" : "tie", reason: "test" }, costs: [] }),
  };
}

describe("Quality Lab", () => {
  it("both versions write from the same facts; the comparison is mapped back correctly whichever side was shown first", async () => {
    for (const r of [0.1, 0.9]) {
      const { result } = await evalLead(set.leads[0], set, { candidate: "2.0", baseline: "1.0" }, deps(picky(), () => r));
      expect(result.winner).toBe("candidate");
      expect(result.candidate.passed && result.baseline.passed).toBe(true);
    }
    const { result } = await evalLead(set.leads[0], set, { candidate: "1.0", baseline: "2.0" }, deps(picky()));
    expect(result.winner).toBe("baseline");
  });

  it("a lead without usable facts is skipped, not counted", async () => {
    const { result } = await evalLead({ first_name: "X", company: "Empty", title: null, domain: "empty.nl" }, set, { candidate: "1.0", baseline: "1.0" }, deps());
    expect(result).toMatchObject({ winner: "skipped", facts: 0 });
  });

  it("research comes from the domain cache the second time", async () => {
    const d = deps();
    let maps = 0;
    d.reader = { ...site, map: async (u) => (maps++, site.map(u)) };
    await runEval({ ...set, leads: [set.leads[0], set.leads[0]] }, { candidate: "1.0", baseline: "1.0" }, d);
    expect(maps).toBe(1);
  });

  it("verdict: ship only on a clear win (≥ 60% of ≥ 10 decided) without more failed checks", () => {
    const side = (passed: boolean) => ({ slots: {}, email: "", passed, failed: [], judgeAvg: passed ? 4 : null });
    const lead = (winner: LeadResult["winner"], cPass = true): LeadResult => ({ company: "x", domain: "x.nl", facts: 3, candidate: side(cPass), baseline: side(true), winner, reason: "" });
    expect(summarise([...Array(7)].map(() => lead("candidate")).concat([...Array(3)].map(() => lead("baseline")))).verdict).toBe("ship");
    expect(summarise([...Array(5)].map(() => lead("candidate")).concat([...Array(5)].map(() => lead("baseline")))).verdict).toBe("no");
    expect(summarise([...Array(5)].map(() => lead("candidate"))).verdict).toBe("inconclusive");
    const worse = summarise([...Array(8)].map(() => lead("candidate")).concat([lead("baseline", false), lead("baseline", false)]));
    expect(worse).toMatchObject({ verdict: "no", verdictText: expect.stringContaining("fails the checks more often") });
  });

  it("the fake LLM has no opinion: identical versions tie", async () => {
    const out = await runEval(set, { candidate: "1.0", baseline: "1.0" }, deps());
    expect(out.summary).toMatchObject({ wins: 0, losses: 0, ties: 1, verdict: "inconclusive" });
  });
});
