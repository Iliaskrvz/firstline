// DeepSeek client without the network: a scripted server that answers like the real API (OpenAI-style
// chat completions, usage with prompt_cache_hit/miss tokens). Covers the request shape, prices by hour,
// JSON validation and retry, errors, the off-peak Economy writer, and the privacy rule end to end.
import { describe, expect, it } from "vitest";
import { engineConfig } from "./config";
import type { WebReader } from "./firecrawl";
import { LLMInvalidOutputError, LLMUnavailableError, type WriteInput } from "./llm";
import { DeepSeekLLM } from "./llm-deepseek";
import { processLead } from "./pipeline";
import { personalValues, scrub } from "./privacy";
import { MemoryStore } from "./store";
import type { LeadJob } from "./types";

const PEAK = new Date("2026-11-16T02:00:00Z"); // Monday 02:00 UTC
const OFF_PEAK = new Date("2026-11-16T12:00:00Z"); // Monday 12:00 UTC
const config = engineConfig({ LLM_PROVIDER: "deepseek", DEEPSEEK_API_KEY: "test-key-not-real" });

type Call = { url: string; headers: Record<string, string>; body: Record<string, unknown> & { messages: { role: string; content: string }[] } };

/** Answers each step with valid JSON built from the request (like FakeLLM), unless `override` says otherwise. */
function server(override?: (call: Call, n: number) => { status?: number; content?: string } | null) {
  const calls: Call[] = [];
  const fetch = async (url: string, init: { headers: Record<string, string>; body?: string }) => {
    const call: Call = { url, headers: init.headers, body: JSON.parse(init.body!) };
    calls.push(call);
    const o = override?.(call, calls.length);
    if (o?.status && o.status !== 200) return { ok: false, status: o.status, text: async () => `{"error":{"message":"scripted ${o.status}"}}` };
    const system = call.body.messages[0].content;
    const user = call.body.messages[1].content;
    let content = o?.content;
    if (content === undefined) {
      if (system.includes('{"facts": [{"id"')) {
        const urls = [...user.matchAll(/url="([^"]+)"/g)].map((m) => m[1]);
        content = JSON.stringify({ facts: [{ id: "F1", text: "Acme Studio opened a second studio in Rotterdam this autumn.", src: urls[1] ?? urls[0], tier: "A" }] });
      } else if (system.includes('"plan":')) {
        const keys = /The "slots" object has exactly these keys: ([^.\n]+)\./.exec(system)![1].split(", ");
        const fact = /F1 \[tier A\] (.+?) \(source/.exec(user)?.[1] ?? "they opened a new studio";
        const slots = Object.fromEntries(
          keys.map((k, i) => [k, i === 0 ? `Read on your site that ${fact.charAt(0).toLowerCase()}${fact.slice(1).replace(/\.$/, "")}.` : "If that keeps your team busy, this could take some work off your plate."]),
        );
        content = JSON.stringify({ plan: { angle: "F1", pain: "growing team", move: ["genuine_interest"], cta_type: "soft_question" }, slots, facts_used: ["F1"], skill_version: "1.0" });
      } else if (system.includes('"relevance"')) {
        content = JSON.stringify({ relevance: 4, specificity: 4, value_clarity: 4, cta_effort: 4, sounds_human: 4, would_reply: 4, claims_supported: true, unsupported_claims: [] });
      } else if (system.includes('"winner"')) {
        content = JSON.stringify({ winner: "a", reason: "more specific" });
      } else {
        content = JSON.stringify({ checks: [{ id: "F1", verdict: "supported", note: "on the page" }] });
      }
    }
    const response = {
      id: "chatcmpl-test",
      object: "chat.completion",
      model: call.body.model,
      choices: [{ index: 0, message: { role: "assistant", content, reasoning_content: null }, finish_reason: "stop" }],
      usage: { prompt_tokens: 3000, completion_tokens: 500, total_tokens: 3500, prompt_tokens_details: { cached_tokens: 2000 }, prompt_cache_hit_tokens: 2000, prompt_cache_miss_tokens: 1000 },
    };
    return { ok: true, status: 200, text: async () => `\n\n${JSON.stringify(response)}` }; // keep-alive blank lines first, like the real API
  };
  return { calls, fetch };
}

const llmWith = (s: ReturnType<typeof server>, now = PEAK) => new DeepSeekLLM(config, { fetch: s.fetch, now: () => now, sleep: async () => {} });

const writeInput = (over: Partial<WriteInput> = {}): WriteInput => ({
  writer: "pro",
  skillVersion: "1.0",
  language: "en",
  template: { subject: "Idea for {{company}}", body: "Hi {{first_name}},\n\n[[opener · something specific · 25]]\n\nBest", slots: [{ key: "opener", instruction: "something specific", max_words: 25 }] },
  styleRules: { language: "en", tone: "direct", banned_phrases: ["synergy"], extra_rules: [] },
  facts: [{ id: "F1", text: "Acme opened a Rotterdam studio.", src: "https://acme.nl/news", tier: "A" }],
  lead: { first_name: "Anna", company: "Acme", title: "Founder", linkedin_headline: null },
  examples: [],
  personal: personalValues({ email: "anna@acme.nl", first_name: "Anna", last_name: "de Vries" }),
  ...over,
});

describe("DeepSeek requests", () => {
  it("OpenAI-style call: base URL, bearer key, the step's model, JSON mode, thinking off, 'json' and an example in the prompt", async () => {
    const s = server();
    await llmWith(s).write(writeInput());
    await llmWith(s).write(writeInput({ writer: "lite" }));
    const [pro, lite] = s.calls;
    expect(pro.url).toBe("https://api.deepseek.com/chat/completions");
    expect(pro.headers.authorization).toBe("Bearer test-key-not-real");
    expect(pro.body).toMatchObject({ model: "deepseek-v4-pro", response_format: { type: "json_object" }, thinking: { type: "disabled" }, stream: false });
    expect(lite.body.model).toBe("deepseek-flash");
    expect(pro.body.messages[0].content).toMatch(/json/);
    expect(pro.body.messages[0].content).toContain('"slots": {"opener"');
  });

  it("stable parts first: the system prompt (skill, JSON format, the customer's copy) is identical for every lead of a campaign", async () => {
    const s = server();
    const llm = llmWith(s);
    await llm.write(writeInput());
    await llm.write(writeInput({ lead: { first_name: "Bob", company: "Other BV", title: null, linkedin_headline: null }, facts: [{ id: "F1", text: "Other BV hired ten people.", src: "https://other.nl", tier: "A" }] }));
    expect(s.calls[0].body.messages[0].content).toBe(s.calls[1].body.messages[0].content);
    expect(s.calls[0].body.messages[1].content).not.toBe(s.calls[1].body.messages[1].content);
    expect(s.calls[0].body.messages[0].content).toContain("[[opener · something specific · 25]]");
    expect(s.calls[0].body.messages[0].content).not.toMatch(/Acme|Rotterdam/);
  });

  it("logs the price of the hour it ran, with cache hits recorded separately", async () => {
    const peak = await llmWith(server(), PEAK).write(writeInput());
    const off = await llmWith(server(), OFF_PEAK).write(writeInput());
    // V4 Pro peak: 2,000 hits × $0.044 + 1,000 misses × $1.32 + 500 out × $3.96 per million.
    expect(peak.costs).toEqual([{ step: "write", model: "deepseek-v4-pro", input_tokens: 1000, output_tokens: 500, cached_tokens: 2000, cost_usd: 0.003388 }]);
    expect(off.costs[0]).toMatchObject({ model: "deepseek-v4-pro (off-peak)", cost_usd: 0.001694 });
  });
});

describe("DeepSeek answers", () => {
  it("empty or invalid JSON is retried once; the second answer is used and both calls are paid", async () => {
    const s = server((_c, n) => (n === 1 ? { content: "   " } : null));
    const r = await llmWith(s).judge({ language: "en", slots: { opener: "x" }, facts: [], emailPreview: "x", role: null, personal: [] });
    expect(r.output.relevance).toBe(4);
    expect(r.costs).toHaveLength(2);
    expect(s.calls[1].body.messages.at(-1)!.content).toMatch(/not valid \(it was empty\)/);
  });

  it("twice invalid: LLMInvalidOutputError with the costs, so the lead gets the free fallback", async () => {
    const s = server(() => ({ content: '{"relevance": "high"}' }));
    const err = await llmWith(s)
      .judge({ language: "en", slots: {}, facts: [], emailPreview: "", role: null, personal: [] })
      .catch((e) => e);
    expect(err).toBeInstanceOf(LLMInvalidOutputError);
    expect(err.costs).toHaveLength(2);
    expect(s.calls).toHaveLength(2);
  });

  it("a bad key or an empty balance stops at once; 429 and 5xx are retried", async () => {
    await expect(llmWith(server(() => ({ status: 401 }))).write(writeInput())).rejects.toThrow(/DeepSeek key invalid/);
    await expect(llmWith(server(() => ({ status: 402 }))).write(writeInput())).rejects.toBeInstanceOf(LLMUnavailableError);
    const s = server((_c, n) => (n === 1 ? { status: 429 } : n === 2 ? { status: 503 } : null));
    expect((await llmWith(s).write(writeInput())).output.facts_used).toEqual(["F1"]);
    expect(s.calls).toHaveLength(3);
  });

  it("Economy waits for off-peak hours, then writes with the writer_economy model", async () => {
    const atPeak = llmWith(server(), PEAK);
    expect(await atPeak.batch.status("offpeak-1")).toBe("in_progress");
    const s = server();
    const off = llmWith(s, OFF_PEAK);
    expect(await off.batch.status("offpeak-1")).toBe("ended");
    const [r] = await off.batch.results("offpeak-1", [{ id: "L1", input: writeInput() }]);
    expect(r.output?.slots.opener).toMatch(/Rotterdam/);
    expect(r.costs[0].model).toBe("deepseek-v4-pro (off-peak)");
    expect(s.calls[0].body.model).toBe("deepseek-v4-pro");
  });
});

describe("privacy: no email, first name, last name or LinkedIn URL ever reaches DeepSeek", () => {
  const SITE: Record<string, string> = {
    "https://acmestudio.nl/": "# Acme Studio\n\nAcme Studio designs packaging for independent food brands across the Netherlands. From the first sketch to the printed box, one team does it all.",
    "https://acmestudio.nl/over-ons":
      "# Over ons\n\nFounder Anna de Vries started the studio in 2012 in Utrecht. Mail anna@acmestudio.nl or see linkedin.com/in/annadevries.\n\nWe opened a second studio in Rotterdam this autumn for our growing client base.",
  };
  const reader: WebReader = {
    robots: async () => null,
    map: async () => ({ links: Object.keys(SITE).map((url) => ({ url })), credits: 1 }),
    scrape: async (url) => ({ markdown: SITE[url] ?? "", statusCode: SITE[url] ? 200 : 404, credits: 1 }),
  };
  const job: LeadJob = {
    lead: {
      id: "lead-1", workspace_id: "ws-1", campaign_id: "c-1", email: "anna@acmestudio.nl", first_name: "Anna", last_name: "de Vries", company: "Acme Studio",
      title: "Founder", linkedin_headline: null, website: "acmestudio.nl", domain: "acmestudio.nl", custom: { linkedin_url: "https://www.linkedin.com/in/annadevries" }, status: "queued",
    },
    campaign: { id: "c-1", writer: "pro", depth: { deep: false } },
    template: {
      id: "t-1",
      subject: "Idea for {{company}}, {{first_name}}",
      body: "Hi {{first_name}} {{last_name}},\n\n[[opener · something specific from their website · 25]]\n\nWe help studios like {{company}} with client reporting.\n\nBest",
      slots: [],
      style_rules: { language: "en" },
      examples: [],
    },
    followUps: [{ step_no: 2, body: "Hi {{first_name}},\n\n[[nudge · a short follow-up line · 20]]\n\nBest" }],
  };

  it("through the whole pipeline (extract, write, judge, follow-up): every request is clean, and the email is still personal", async () => {
    const s = server();
    const store = new MemoryStore();
    store.jobs.set("lead-1", structuredClone(job));
    const res = await processLead("lead-1", { store, reader, llm: llmWith(s), config, now: () => PEAK }, { preview: true });
    expect(res.outcome).toBe("done");
    const bodies = s.calls.map((c) => JSON.stringify(c.body));
    expect(bodies.length).toBeGreaterThanOrEqual(4);
    expect(bodies.some((b) => b.includes('\\"relevance\\"'))).toBe(true); // the judge ran
    expect(bodies.some((b) => b.includes("follow-up email 2"))).toBe(true); // the follow-up ran
    for (const b of bodies) {
      expect(b).not.toMatch(/\banna\b/i);
      expect(b).not.toMatch(/vries/i);
      expect(b).not.toMatch(/anna@acmestudio\.nl/i);
      expect(b).not.toMatch(/linkedin\.com/i);
    }
    // Our own code fills the name in after the AI step.
    expect(store.generations[0].full_email).toMatch(/^Hi Anna de Vries,/);
    expect(store.generations.find((g) => g.step_no === 2)?.full_email ?? "").toMatch(/^Hi Anna,/);
  });

  it("scrubs whole words only, any email address and any LinkedIn URL", () => {
    const p = personalValues({ email: "mark.jansen@bakkerij.nl", first_name: "Mark", last_name: "Jansen", custom: { "LinkedIn profile": "https://nl.linkedin.com/in/mjansen" } });
    expect(scrub("Mark Jansen knows the market. Mail mark.jansen@bakkerij.nl, other@x.com or https://nl.linkedin.com/in/mjansen", p)).toBe(
      "[contact] knows the market. Mail [email], [email] or [link]",
    );
  });
});
