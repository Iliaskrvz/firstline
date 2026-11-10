import { describe, expect, it } from "vitest";
import { allPass, planCheck, ruleChecks, type CheckContext } from "./checks";
import { detectLanguage } from "./language";
import { anthropicCost, firecrawlCostEntry } from "./costs";
import { fallbackSlots } from "./fallback";
import type { Fact, WriterOutput } from "./types";

const facts: Fact[] = [
  { id: "F1", text: "Acme Studio opened a second studio in Utrecht in 2025.", src: "https://acme.nl/nieuws", tier: "A" },
  { id: "F2", text: "Acme Studio designs packaging for food brands.", src: "https://acme.nl/diensten", tier: "A" },
  { id: "C1", text: "Their role: Founder", src: "csv", tier: "C" },
];
const ctx: CheckContext = {
  slots: [
    { key: "opener", instruction: "x", max_words: 25 },
    { key: "bridge", instruction: "y", max_words: 25 },
  ],
  facts,
  language: "en",
  skillVersion: "1.0",
  extraBanned: ["synergies"],
  company: "Acme Studio",
};
const good: WriterOutput = {
  plan: { angle: "F1", pain: "growing pains", move: ["genuine_interest"], cta_type: "soft_question" },
  slots: {
    opener: "Congrats on opening your second studio in Utrecht in 2025.",
    bridge: "With two locations, keeping your client updates consistent can get messy.",
  },
  facts_used: ["F1"],
  skill_version: "1.0",
};
const failing = (o: Partial<WriterOutput> & { slots?: Record<string, string> }) => {
  const out = { ...good, ...o, slots: { ...good.slots, ...(o.slots ?? {}) } };
  return [...planCheck(out, ctx), ...ruleChecks(out, ctx)].filter((i) => !i.pass).map((i) => i.id);
};

describe("checks", () => {
  it("a good output passes everything", () => {
    expect(allPass([...planCheck(good, ctx), ...ruleChecks(good, ctx)])).toBe(true);
  });

  it("plan: unknown moves, CTA, fact IDs, angle not in opener, wrong slots", () => {
    expect(failing({ plan: { ...good.plan, move: ["flattery" as never] } })).toEqual(["plan_moves"]);
    expect(failing({ plan: { ...good.plan, move: ["proof", "value_stack", "risk_reversal"] } })).toEqual(["plan_moves"]);
    expect(failing({ plan: { ...good.plan, cta_type: "book_meeting" as never } })).toEqual(["plan_cta"]);
    expect(failing({ facts_used: ["F1", "F9"] })).toEqual(["plan_facts_exist"]);
    expect(failing({ plan: { ...good.plan, angle: "F2" }, facts_used: ["F2"] })).toContain("plan_angle_in_opener");
    expect(failing({ plan: { ...good.plan, angle: "C1" }, facts_used: ["C1"], slots: { opener: "As a founder in their role you know this." } })).toContain("plan_angle_tier");
    expect(failing({ slots: { ps: "extra" } })).toEqual(["plan_slots_match"]);
  });

  it("the company name alone doesn't count as reflecting the angle", () => {
    const out = { ...good, slots: { ...good.slots, opener: "Acme Studio caught my eye this week." } };
    expect(planCheck(out, ctx).find((i) => i.id === "plan_angle_in_opener")!.pass).toBe(false);
  });

  it("rules: word count, questions, banned, exclamation, links, spam", () => {
    expect(failing({ slots: { opener: `Congrats on Utrecht ${"word ".repeat(25)}` } })).toContain("words_opener");
    expect(failing({ slots: { bridge: "Is it messy? Is it slow?" } })).toContain("questions_bridge");
    expect(failing({ slots: { bridge: "I came across your studio in Utrecht." } })).toContain("banned");
    expect(failing({ slots: { bridge: "We see synergies with your team." } })).toContain("banned");
    expect(failing({ slots: { bridge: "Your team must be busy!" } })).toEqual(expect.arrayContaining(["exclamation"]));
    expect(failing({ slots: { bridge: "See acme.nl for your options." } })).toContain("links");
    expect(failing({ slots: { bridge: "Your free guaranteed upgrade." } })).toContain("spam");
  });

  it("rules: you/we ratio, numbers not in facts, personal topics", () => {
    expect(failing({ slots: { bridge: "We built our tool because we and our team love it." } })).toContain("you_we");
    expect(failing({ slots: { bridge: "Your 40 designers must be busy." } })).toContain("numbers");
    expect(failing({ slots: { bridge: "Hope your kids enjoy the new studio." } })).toContain("tier_x");
    expect(failing({ slots: { bridge: "Saw your Instagram, your new studio looks great." } })).toContain("tier_x");
    expect(failing({ slots: { bridge: "Hoe gaat het met je kinderen?" } })).toContain("tier_x");
    // A company's own cause is business content, not the reader's private life.
    expect(failing({ slots: { bridge: "Your fight against child labour in cocoa clearly matters to your team." } })).not.toContain("tier_x");
  });

  it("Dutch you/we and banned phrases", () => {
    const nl = { ...ctx, language: "nl" as const };
    const out: WriterOutput = { ...good, slots: { opener: "Mooi dat jullie in 2025 een tweede studio in Utrecht openden.", bridge: "Ik kwam jullie bureau tegen, wij en ons team helpen graag." } };
    const ids = [...planCheck(out, nl), ...ruleChecks(out, nl)].filter((i) => !i.pass).map((i) => i.id);
    expect(ids).toEqual(expect.arrayContaining(["banned", "you_we"]));
  });
});

describe("language, costs, fallback", () => {
  it("detects the copy's language, ignoring markers", () => {
    expect(detectLanguage("Hoi {{first_name}}, [[opener · x]] Wij helpen bedrijven zoals jullie met de administratie.")).toBe("nl");
    expect(detectLanguage("Hallo, wir helfen Ihnen und Ihrem Team mit der Buchhaltung.")).toBe("de");
    expect(detectLanguage("Hi, we help teams like yours with the boring parts.")).toBe("en");
    expect(detectLanguage("[[opener · x]]")).toBe("en");
  });

  it("prices Claude and Firecrawl calls", () => {
    expect(anthropicCost("claude-sonnet-5-5", { input_tokens: 1000, output_tokens: 500, cache_read_input_tokens: 2000 })).toBe(0.0072);
    expect(anthropicCost("claude-sonnet-5-5", { input_tokens: 1000, output_tokens: 500, cache_read_input_tokens: 2000 }, { batch: true })).toBe(0.0036);
    expect(anthropicCost("claude-haiku-5-5", { input_tokens: 10_000, output_tokens: 1000 })).toBe(0.0015);
    expect(anthropicCost("unknown", { input_tokens: 1, output_tokens: 1 })).toBe(0);
    expect(firecrawlCostEntry("scrape", 1, 0.00083)).toEqual({ step: "scrape", model: "firecrawl-scrape", provider_units: 1, cost_usd: 0.00083 });
  });

  it("fallback writes a neutral first slot only", () => {
    expect(fallbackSlots(ctx.slots, "nl")).toEqual({ opener: "Ik houd het kort.", bridge: "" });
  });
});
