// The writer request is built so prompt caching works (no network: only the request shape).
import { describe, expect, it } from "vitest";
import { engineConfig } from "./config";
import type { WriteInput } from "./llm";
import { AnthropicLLM } from "./llm-anthropic";

const llm = new AnthropicLLM(engineConfig({ LLM_PROVIDER: "anthropic", ANTHROPIC_API_KEY: "sk-ant-test-not-real" }));
const base: WriteInput = {
  writer: "pro",
  skillVersion: "1.0",
  language: "en",
  template: { subject: "Idea for {{company}}", body: "Hi {{first_name}},\n\n[[opener · something specific · 25]]\n\nBest", slots: [{ key: "opener", instruction: "something specific", max_words: 25 }] },
  styleRules: { language: "en", tone: "direct", banned_phrases: ["synergy"], extra_rules: [] },
  facts: [{ id: "F1", text: "Acme opened a Rotterdam studio.", src: "https://acme.nl/news", tier: "A" }],
  lead: { first_name: "Anna", company: "Acme", title: "Founder", linkedin_headline: null },
  examples: [],
};

describe("writer request (prompt caching)", () => {
  it("puts the skill prompt and the campaign block in cached system blocks, the lead in the user message", () => {
    const r = llm.writeRequest(base);
    expect(r.model).toBe("claude-sonnet-5-5");
    expect(r.system).toHaveLength(2);
    expect(r.system.every((b) => b.cache_control?.type === "ephemeral")).toBe(true);
    expect(r.system[1].text).toContain("[[opener · something specific · 25]]");
    expect(r.system[1].text).toContain("never use: synergy");
    const user = r.messages[0].content;
    expect(user).toContain("Anna at Acme");
    expect(user).toContain("F1 [tier A]");
    // Nothing about this lead leaks into the cached prefix.
    expect(r.system.map((b) => b.text).join("\n")).not.toMatch(/Anna|Rotterdam/);
  });

  it("the cached prefix is byte-identical for every lead of a campaign, also on a rewrite or follow-up", () => {
    const a = llm.writeRequest(base);
    const b = llm.writeRequest({
      ...base,
      lead: { first_name: "Bob", company: "Other BV", title: null, linkedin_headline: null },
      facts: [{ id: "F1", text: "Other BV hired ten people.", src: "https://other.nl", tier: "A" }],
      feedback: ["Too long"],
      previous: { plan: { angle: "F1", pain: "x", move: ["genuine_interest"], cta_type: "soft_question" }, slots: { opener: "x" }, facts_used: ["F1"], skill_version: "1.0" },
    });
    const c = llm.writeRequest({ ...base, followUp: { stepNo: 2, firstEmail: "Hi Anna, ..." } });
    expect(JSON.stringify(b.system)).toBe(JSON.stringify(a.system));
    expect(JSON.stringify(c.system)).toBe(JSON.stringify(a.system));
  });

  it("a different template or language is a different campaign block, same skill block", () => {
    const a = llm.writeRequest(base);
    const nl = llm.writeRequest({ ...base, language: "nl" });
    expect(nl.system[0].text).toBe(a.system[0].text);
    expect(nl.system[1].text).not.toBe(a.system[1].text);
  });

  it("the Lite writer uses Haiku", () => {
    expect(llm.writeRequest({ ...base, writer: "lite" }).model).toBe("claude-haiku-5-5");
  });
});
