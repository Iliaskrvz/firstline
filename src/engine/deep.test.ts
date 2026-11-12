import { describe, expect, it } from "vitest";
import { engineConfig } from "./config";
import { blockedHost, findPersonFacts, pageMatches } from "./deep";
import type { SearchResult, WebReader } from "./firecrawl";
import { FakeLLM } from "./llm-fake";
import type { LLM } from "./llm";
import type { PersonFactsOutput } from "./schemas";

const config = engineConfig({ DEEP_RESEARCH_ENABLED: "1" });
const anna = { first_name: "Anna", last_name: "de Vries", company: "Acme Studio", domain: "acmestudio.nl", title: "Founder" };

const TALK = "# Packaging Days 2026\n\nAnna de Vries, founder of Acme Studio, gave a talk on refill packaging for small food brands at Packaging Days in Utrecht.";
const OTHER = "# Gardening\n\nAnna de Vries from Groningen won the village vegetable contest.";

function reader(results: SearchResult[], pages: Record<string, string>, calls: string[] = []): WebReader {
  return {
    async map() {
      return { links: [], credits: 1 };
    },
    async robots() {
      return null;
    },
    async scrape(url) {
      calls.push(`scrape ${url}`);
      return { markdown: pages[url] ?? "", statusCode: 200, credits: 1 };
    },
    async search(query, limit) {
      calls.push(`search ${query} (${limit})`);
      return { results, credits: 2 };
    },
  };
}

const talkResult = { url: "https://packagingdays.nl/sprekers/anna-de-vries", title: "Anna de Vries · Packaging Days", description: "Talk by Anna de Vries (Acme Studio)" };

describe("Deep research (narrow)", () => {
  it("doesn't search without a full name and company website", async () => {
    const calls: string[] = [];
    const r = await findPersonFacts({ ...anna, last_name: null }, { reader: reader([], {}, calls), llm: new FakeLLM(), config });
    expect(r).toMatchObject({ status: "not_searched", facts: [] });
    expect(calls).toEqual([]);
  });

  it("one search for the name with the company, never LinkedIn; reads at most 2 pages that name the person", async () => {
    const calls: string[] = [];
    const results = [
      { url: "https://www.linkedin.com/in/annadevries", title: "Anna de Vries | LinkedIn", description: "Anna de Vries" },
      { url: "https://rocketreach.co/anna-de-vries", title: "Anna de Vries email", description: "" },
      { url: "https://example.com/unrelated", title: "Packaging trends", description: "nothing about her" },
      talkResult,
      { url: "https://acmestudio.nl/nieuws/anna", title: "Anna de Vries in the news", description: "" },
      { url: "https://third.nl/anna", title: "Anna de Vries again", description: "" },
    ];
    const r = await findPersonFacts(anna, { reader: reader(results, { [talkResult.url]: TALK }, calls), llm: new FakeLLM(), config });
    expect(calls[0]).toBe(`search "Anna de Vries" "Acme Studio" -site:linkedin.com (5)`);
    expect(calls.slice(1)).toEqual([`scrape ${talkResult.url}`, "scrape https://acmestudio.nl/nieuws/anna"]);
    expect(r.status).toBe("matched");
    expect(r.facts).toEqual([{ id: "P1", text: expect.stringContaining("gave a talk on refill packaging"), src: talkResult.url, tier: "D" }]);
    expect(r.costs.map((c) => c.model)).toEqual(["firecrawl-search", "firecrawl-scrape", "firecrawl-scrape"]);
  });

  it("no confident match when a page names someone with the same name but not the company: nothing used, AI not asked", async () => {
    let asked = false;
    const llm: LLM = Object.assign(new FakeLLM(), {
      async personFacts(): Promise<never> {
        asked = true;
        throw new Error("should not be called");
      },
    });
    const r = await findPersonFacts(anna, { reader: reader([{ ...talkResult, description: "Anna de Vries" }], { [talkResult.url]: OTHER }), llm, config });
    expect(r).toMatchObject({ status: "no_match", facts: [] });
    expect(asked).toBe(false);
  });

  const withAnswer = (out: PersonFactsOutput): LLM =>
    Object.assign(new FakeLLM(), {
      async personFacts() {
        return { output: out, costs: [] };
      },
    });

  it("uses nothing unless the AI says it's the same person", async () => {
    const r = await findPersonFacts(anna, {
      reader: reader([talkResult], { [talkResult.url]: TALK }),
      llm: withAnswer({ same_person: "unsure", reason: "two people", facts: [{ text: "Gave a talk", src: talkResult.url, kind: "talk", date: null }] }),
      config,
    });
    expect(r).toMatchObject({ status: "no_match", facts: [] });
  });

  it("drops personal-life facts, facts from pages not read, unknown kinds; keeps at most 2", async () => {
    const r = await findPersonFacts(anna, {
      reader: reader([talkResult], { [talkResult.url]: TALK }),
      llm: withAnswer({
        same_person: "yes",
        reason: "named with company",
        facts: [
          { text: "Talked about her pregnancy and her kids", src: talkResult.url, kind: "talk", date: null },
          { text: "Wrote about refill packaging", src: "https://elsewhere.com/x", kind: "article", date: null },
          { text: "Gave a talk on refill packaging at Packaging Days", src: talkResult.url, kind: "talk", date: "2026-10" },
          { text: "Was named in Acme Studio's Rotterdam launch news", src: talkResult.url, kind: "company_news", date: null },
          { text: "A third fact", src: talkResult.url, kind: "article", date: null },
        ],
      }),
      config,
    });
    expect(r.status).toBe("matched");
    expect(r.facts.map((f) => f.text)).toEqual(["Gave a talk on refill packaging at Packaging Days", "Was named in Acme Studio's Rotterdam launch news"]);
    expect(r.facts.map((f) => f.id)).toEqual(["P1", "P2"]);
  });

  it("helpers", () => {
    expect(blockedHost("https://nl.linkedin.com/in/x")).toBe(true);
    expect(blockedHost("https://acmestudio.nl/team")).toBe(false);
    expect(pageMatches("Ánna de Vríes leads ACME Studio B.V.", { first: "Anna", last: "de Vries", company: "Acme Studio B.V.", domain: "acmestudio.nl" })).toBe(true);
    expect(pageMatches("Anna de Vries likes gardening", { first: "Anna", last: "de Vries", company: "Acme Studio", domain: "acmestudio.nl" })).toBe(false);
  });
});
