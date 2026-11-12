import { describe, expect, it } from "vitest";
import { engineConfig } from "./config";
import type { WebReader } from "./firecrawl";
import { FakeLLM } from "./llm-fake";
import { MissingKeyLLM, type LLM } from "./llm";
import { processLead } from "./pipeline";
import { MemoryStore } from "./store";
import type { LeadJob } from "./types";

const config = engineConfig({});
const BODY = "Hi {{first_name}},\n\n[[opener · something specific from their website · 25]]\n\nWe help studios like {{company}} with client reporting. [[bridge · one sentence linking their situation to reporting · 25]]\n\nWorth a look?";

const SITE: Record<string, string> = {
  "https://acmestudio.nl/": "# Acme Studio\n\nAcme Studio designs packaging for independent food brands across the Netherlands. From the first sketch to the printed box, one team handles the whole process for each client.\n\n- [Home](https://acmestudio.nl/)\n- [Over ons](https://acmestudio.nl/over-ons)",
  "https://acmestudio.nl/over-ons": "# Over ons\n\nWe started in 2012 as a two-person studio in Utrecht and now have a team of twelve designers.\n\nWe opened a second studio in Rotterdam this autumn for our growing client base.",
  "https://acmestudio.nl/nieuws/2025/10/rotterdam": "# Nieuws\n\nOur new Rotterdam studio opened in October with a launch event for local food entrepreneurs. More than forty founders joined the evening to see the new workshop space.",
};

function fakeReader(site = SITE, calls: string[] = []): WebReader {
  return {
    async robots() {
      return "User-agent: *\nDisallow: /admin";
    },
    async map() {
      calls.push("map");
      return { links: [...Object.keys(site), "https://acmestudio.nl/privacy"].map((url) => ({ url })), credits: 1 };
    },
    async scrape(url) {
      calls.push(`scrape ${url}`);
      if (!(url in site)) return { markdown: "", statusCode: 404, credits: 1 };
      return { markdown: site[url], statusCode: 200, credits: 1 };
    },
  };
}

function job(over: Partial<LeadJob["lead"]> = {}): LeadJob {
  return {
    lead: {
      id: "lead-1", workspace_id: "ws-1", campaign_id: "c-1", email: "anna@acmestudio.nl", first_name: "Anna", last_name: "de Vries",
      company: "Acme Studio", title: "Founder", linkedin_headline: null, website: "acmestudio.nl", domain: "acmestudio.nl", custom: {}, status: "queued", ...over,
    },
    campaign: { id: "c-1", writer: "pro", depth: { deep: false } },
    template: { id: "t-1", subject: "Idea for {{company}}", body: BODY, slots: [], style_rules: { language: "en" }, examples: [] },
  };
}

function setup(llm: LLM = new FakeLLM(), j = job(), reader = fakeReader()) {
  const store = new MemoryStore();
  store.jobs.set(j.lead.id, j);
  return { store, deps: { store, reader, llm, config, now: () => new Date("2026-11-09T12:00:00Z") } };
}

describe("processLead (fake LLM, fake website)", () => {
  it("researches, extracts facts, writes, validates and saves", async () => {
    const calls: string[] = [];
    const { store, deps } = setup(new FakeLLM(), job(), fakeReader(SITE, calls));
    const res = await processLead("lead-1", deps, { preview: true });

    expect(res.outcome).toBe("done");
    expect(calls).toEqual([
      "map",
      "scrape https://acmestudio.nl/",
      "scrape https://acmestudio.nl/over-ons",
      "scrape https://acmestudio.nl/nieuws/2025/10/rotterdam",
    ]);
    const g = store.generations[0];
    expect(g.provider).toBe("fake");
    expect(g.is_preview).toBe(true);
    expect(g.full_email).toMatch(/^Hi Anna,\n\nRead on your site that /);
    expect(g.full_email).toContain("We help studios like Acme Studio with client reporting.");
    expect((g.checks as { status: string }).status).toBe("passed");
    expect(store.statuses.get("lead-1")!.map((s) => s.status)).toEqual(["researching", "writing", "done"]);
    // 1 map + 3 scrapes logged as real Firecrawl costs; fake LLM costs nothing.
    expect(store.costs.map((c) => c.model)).toEqual(["firecrawl-map", "firecrawl-scrape", "firecrawl-scrape", "firecrawl-scrape"]);
    expect(res.costUsd).toBeCloseTo(4 * 0.00083, 6);
    expect(store.research.get("acmestudio.nl")).toMatchObject({ status: "ok", extractor: "fake" });
  });

  it("is idempotent: a settled lead is skipped", async () => {
    const { store, deps } = setup();
    await processLead("lead-1", deps);
    const again = await processLead("lead-1", deps);
    expect(again.outcome).toBe("skipped");
    expect(store.generations).toHaveLength(1);
  });

  it("uses the 30-day domain cache for the next lead at the same company", async () => {
    const calls: string[] = [];
    const { store, deps } = setup(new FakeLLM(), job(), fakeReader(SITE, calls));
    await processLead("lead-1", deps);
    store.jobs.set("lead-2", { ...job({ id: "lead-2", email: "bob@acmestudio.nl", first_name: "Bob" }) });
    const n = calls.length;
    const res = await processLead("lead-2", deps);
    expect(res.outcome).toBe("done");
    expect(calls.length).toBe(n); // no new Firecrawl calls
    expect(res.costUsd).toBe(0);
    expect((store.generations[1].research as { cached: boolean }).cached).toBe(true);
  });

  it("never reuses facts from a different extractor (fake vs Claude)", async () => {
    const { store, deps } = setup();
    store.research.set("acmestudio.nl", {
      domain: "acmestudio.nl", pages: [], facts: [{ id: "F1", text: "x", src: "https://acmestudio.nl/", tier: "A" }],
      status: "ok", extractor: "claude-haiku-5-5:extract-1.0", researched_at: "2026-11-01T00:00:00Z", expires_at: "2026-12-01T00:00:00Z",
    });
    await processLead("lead-1", deps);
    expect(store.research.get("acmestudio.nl")!.extractor).toBe("fake");
  });

  it("no website -> free fallback with a neutral line", async () => {
    const { store, deps } = setup(new FakeLLM(), job({ domain: null, website: null }));
    const res = await processLead("lead-1", deps);
    expect(res).toMatchObject({ outcome: "fallback", detail: "No website in the CSV", costUsd: 0 });
    expect(store.generations[0].full_email).toContain("I'll keep this short.");
    expect(store.costs).toEqual([]);
  });

  it("writes personalised follow-ups from the same facts, before marking the lead done", async () => {
    const j = job();
    j.followUps = [{ step_no: 2, body: "Hi {{first_name}}, one more thing: [[angle2 · a different fact from their site · 25]]" }];
    const calls: string[] = [];
    const { store, deps } = setup(new FakeLLM(), j, fakeReader(SITE, calls));
    const res = await processLead("lead-1", deps);
    expect(res.outcome).toBe("done");
    const [first, second] = store.generations;
    expect(first.step_no ?? 1).toBe(1);
    expect(second).toMatchObject({ step_no: 2, subject: "", checks: { status: "passed" } });
    expect(second.full_email).toMatch(/^Hi Anna, one more thing: /);
    expect(second.facts_used).not.toEqual(first.facts_used); // a different angle
    expect(calls.filter((c) => c === "map")).toHaveLength(1); // no extra research
    // The lead is only marked done after its follow-ups exist (a retry rewrites everything).
    expect(store.statuses.get("lead-1")!.at(-1)!.status).toBe("done");
  });

  it("a fallback lead gets neutral follow-ups, never invented claims", async () => {
    const j = job({ domain: null, website: null });
    j.followUps = [{ step_no: 2, body: "Hi {{first_name}}, [[angle2 · a different fact · 25]]" }];
    const { store, deps } = setup(new FakeLLM(), j);
    expect((await processLead("lead-1", deps)).outcome).toBe("fallback");
    expect(store.generations[1]).toMatchObject({ step_no: 2, facts_used: [], checks: { status: "fallback", reason: "no_facts" } });
    expect(store.generations[1].full_email).toBe("Hi Anna, I'll keep this short.");
  });

  describe("credits (§3)", () => {
    it("a written lead pays 1 + 1 per written personalised follow-up", async () => {
      const j = job();
      j.followUps = [{ step_no: 2, body: "Hi {{first_name}}, [[angle2 · a different fact from their site · 25]]" }];
      const { store, deps } = setup(new FakeLLM(), j);
      expect((await processLead("lead-1", deps)).outcome).toBe("done");
      expect(store.settled).toEqual([{ leadId: "lead-1", used: 2 }]);
    });

    it("fallbacks and failures are free; previews never touch credits", async () => {
      const fb = setup(new FakeLLM(), job({ domain: null, website: null }));
      await processLead("lead-1", fb.deps);
      expect(fb.store.settled).toEqual([{ leadId: "lead-1", used: 0 }]);

      const failed = setup(new MissingKeyLLM());
      expect((await processLead("lead-1", failed.deps)).outcome).toBe("failed");
      expect(failed.store.settled).toEqual([{ leadId: "lead-1", used: 0 }]);

      const preview = setup();
      await processLead("lead-1", preview.deps, { preview: true });
      expect(preview.store.settled).toEqual([]);
    });

    it("a stopped run skips the lead and gives its credits back", async () => {
      const j = job();
      j.campaign.status = "cancelled";
      const calls: string[] = [];
      const { store, deps } = setup(new FakeLLM(), j, fakeReader(SITE, calls));
      expect(await processLead("lead-1", deps)).toMatchObject({ outcome: "skipped", detail: "Run stopped" });
      expect(store.settled).toEqual([{ leadId: "lead-1", used: 0 }]);
      expect(calls).toEqual([]); // no research spent
    });
  });

  describe("Economy mode (§9)", () => {
    const economy = () => {
      const j = job();
      j.campaign.mode = "economy";
      return j;
    };

    it("defers the first write, then finishes the lead from the batch's answer", async () => {
      const calls: string[] = [];
      const { store, deps } = setup(new FakeLLM(), economy(), fakeReader(SITE, calls));
      const first = await processLead("lead-1", deps);
      expect(first.outcome).toBe("deferred");
      expect(store.deferred.get("lead-1")).toMatchObject({ skillVersion: "1.0", lead: { first_name: "Anna" } });
      expect(store.generations).toEqual([]); // nothing written yet
      expect(store.settled).toEqual([]); // the credit stays reserved
      expect(store.statuses.get("lead-1")!.at(-1)).toMatchObject({ status: "writing", detail: expect.stringContaining("Economy") });

      // The batch answers (here: what the writer would have written), at the batch price.
      const answer = await new FakeLLM().write(store.deferred.get("lead-1")!);
      store.batchResults.set("lead-1", { output: answer.output, costs: [{ step: "write", model: "claude-sonnet-5-5 (batch)", cost_usd: 0.004 }] });
      const second = await processLead("lead-1", deps);
      expect(second).toMatchObject({ outcome: "done", costUsd: 0.004 });
      expect(store.generations[0].slot_outputs).toEqual(answer.output.slots);
      expect(store.settled).toEqual([{ leadId: "lead-1", used: 1 }]);
      expect(store.batchResults.has("lead-1")).toBe(false); // used up
      expect(calls.filter((c) => c === "map")).toHaveLength(1); // the second pass reads research from the cache
    });

    it("a failed batch item is written directly; previews and 'now' campaigns never wait", async () => {
      const failed = setup(new FakeLLM(), economy());
      failed.store.batchResults.set("lead-1", { costs: [], error: "Batch request expired" });
      expect((await processLead("lead-1", failed.deps)).outcome).toBe("done");

      const preview = setup(new FakeLLM(), economy());
      expect((await processLead("lead-1", preview.deps, { preview: true })).outcome).toBe("done");

      const now = setup();
      expect((await processLead("lead-1", now.deps)).outcome).toBe("done");
      expect(now.store.deferred.size).toBe(0);
    });

    it("a lead with no website doesn't wait for a batch: it falls back at once", async () => {
      const j = economy();
      j.lead.domain = null;
      const { store, deps } = setup(new FakeLLM(), j);
      expect((await processLead("lead-1", deps)).outcome).toBe("fallback");
      expect(store.deferred.size).toBe(0);
    });
  });

  it("unreachable site -> fallback, and the failure is cached briefly", async () => {
    const dead: WebReader = {
      robots: async () => null,
      map: async () => { throw new Error("DNS failure"); },
      scrape: async () => { throw new Error("DNS failure"); },
    };
    const { store, deps } = setup(new FakeLLM(), job(), dead);
    const res = await processLead("lead-1", deps);
    expect(res).toMatchObject({ outcome: "fallback", detail: "Website unreachable" });
    expect(store.research.get("acmestudio.nl")).toMatchObject({ status: "unreachable", expires_at: "2026-11-16T12:00:00.000Z" });
  });

  it("site that answers 403 (bot protection) -> 'blocks automated reading', not 'unreachable'", async () => {
    const reader: WebReader = {
      ...fakeReader(),
      map: async () => ({ links: [{ url: "https://acmestudio.nl/" }], credits: 1 }),
      scrape: async () => ({ markdown: "", statusCode: 403, credits: 1 }),
    };
    const { store, deps } = setup(new FakeLLM(), job(), reader);
    const res = await processLead("lead-1", deps);
    expect(res).toMatchObject({ outcome: "fallback", detail: "Website blocks automated reading" });
    expect(store.research.get("acmestudio.nl")).toMatchObject({ status: "refused", expires_at: "2026-11-16T12:00:00.000Z" });
  });

  it("robots.txt that blocks everything -> fallback without scraping", async () => {
    const calls: string[] = [];
    const reader = { ...fakeReader(SITE, calls), robots: async () => "User-agent: *\nDisallow: /" };
    const { deps } = setup(new FakeLLM(), job(), reader);
    expect((await processLead("lead-1", deps)).detail).toBe("Website asks robots not to read these pages");
    expect(calls).toEqual([]);
  });

  it("missing Anthropic key -> clear status, research still shown, no crash", async () => {
    const { store, deps } = setup(new MissingKeyLLM());
    const res = await processLead("lead-1", deps);
    expect(res).toMatchObject({ outcome: "failed", detail: "Anthropic key missing" });
    expect(store.statuses.get("lead-1")!.at(-1)).toEqual({ status: "failed", detail: "Anthropic key missing", confidence: null });
    const research = store.generations[0].research as { pages: { type: string }[]; ai: string };
    expect(research.ai).toBe("Anthropic key missing");
    expect(research.pages.map((p) => p.type)).toEqual(["home", "about", "news"]);
  });

  it("output that fails checks gets one rewrite, then falls back", async () => {
    const llm = new FakeLLM();
    let writes = 0;
    llm.write = async (input) => {
      writes++;
      return { output: { plan: { angle: "F1", pain: "x", move: ["genuine_interest"], cta_type: "soft_question" }, slots: { opener: "Amazing!", bridge: "Click here!" }, facts_used: ["F1"], skill_version: input.skillVersion }, costs: [] };
    };
    const { store, deps } = setup(llm);
    const res = await processLead("lead-1", deps);
    expect(writes).toBe(2);
    expect(res).toMatchObject({ outcome: "fallback", detail: "Didn't pass the checks after one rewrite" });
    expect((store.generations[0].checks as { rejected: unknown }).rejected).toBeTruthy();
  });

  it("transient errors are thrown so the queue retries the job", async () => {
    const llm = new FakeLLM();
    llm.write = async () => { throw new Error("503 overloaded"); };
    const { deps } = setup(llm);
    await expect(processLead("lead-1", deps)).rejects.toThrow("503");
  });
});

describe("Deep research in the pipeline (switch on only in these tests)", () => {
  const deepConfig = engineConfig({ DEEP_RESEARCH_ENABLED: "1" });
  const TALK_URL = "https://packagingdays.nl/sprekers/anna-de-vries";
  const TALK = "# Packaging Days 2026\n\nAnna de Vries, founder of Acme Studio, gave a talk on refill packaging for small food brands at Packaging Days in Utrecht.";
  function deepReader(calls: string[] = []): WebReader {
    const base = fakeReader(SITE, calls);
    return {
      ...base,
      async scrape(url, t) {
        if (url === TALK_URL) {
          calls.push(`scrape ${url}`);
          return { markdown: TALK, statusCode: 200, credits: 1 };
        }
        return base.scrape(url, t);
      },
      async search(q) {
        calls.push(`search ${q}`);
        return { results: [{ url: TALK_URL, title: "Anna de Vries · Packaging Days", description: "Talk by Anna de Vries" }], credits: 2 };
      },
    };
  }
  const deepJob = (over: Partial<LeadJob["lead"]> = {}) => ({ ...job(over), campaign: { id: "c-1", writer: "pro" as const, depth: { deep: true } } });
  function run(j: LeadJob, cfg = deepConfig, calls: string[] = []) {
    const store = new MemoryStore();
    store.jobs.set(j.lead.id, j);
    return { store, calls, go: () => processLead(j.lead.id, { store, reader: deepReader(calls), llm: new FakeLLM(), config: cfg, now: () => new Date("2026-11-12T12:00:00Z") }) };
  }

  it("uses one fact about the contact's own work in the first email, charges Deep only because it was used, and keeps it out of the domain cache", async () => {
    const t = run(deepJob());
    expect((await t.go()).outcome).toBe("done");
    const g = t.store.generations[0];
    expect(g.facts_used).toEqual(["P1"]);
    expect(g.full_email).toMatch(/Saw your work: anna de Vries, founder of Acme Studio, gave a talk/i);
    expect(t.store.settled).toEqual([{ leadId: "lead-1", used: 2 }]);
    // Stored with the lead, not in the shared domain cache.
    expect(t.store.personResearch.get("lead-1")).toMatchObject({ status: "matched", facts: [{ id: "P1", tier: "D", src: TALK_URL }] });
    expect(JSON.stringify(t.store.research.get("acmestudio.nl"))).not.toContain("Packaging Days");
    expect((g.research as { person: { status: string } }).person.status).toBe("matched");
  });

  it("no confident match: nothing used and Deep isn't charged", async () => {
    const t = run(deepJob({ last_name: "Jansen" }));
    await t.go();
    expect(t.store.personResearch.get("lead-1")).toMatchObject({ status: "no_match", facts: [] });
    expect(t.store.settled).toEqual([{ leadId: "lead-1", used: 1 }]);
  });

  it("never searches a contact on the do-not-contact list", async () => {
    const t = run(deepJob());
    t.store.suppressed.add("anna@acmestudio.nl");
    await t.go();
    expect(t.calls.some((c) => c.startsWith("search"))).toBe(false);
    expect(t.store.personResearch.get("lead-1")).toMatchObject({ status: "not_searched", detail: "On the do-not-contact list: not searched" });
  });

  it("does nothing while the switch is off, even for a campaign set to Deep", async () => {
    const t = run(deepJob(), engineConfig({}));
    await t.go();
    expect(t.calls.some((c) => c.startsWith("search"))).toBe(false);
    expect(t.store.personResearch.size).toBe(0);
    expect(t.store.settled).toEqual([{ leadId: "lead-1", used: 1 }]);
  });

  it("a re-run reuses the earlier result instead of searching again", async () => {
    const j = deepJob({ deep_status: "matched", person_facts: [{ id: "P1", text: "Gave a talk on refill packaging", src: TALK_URL, tier: "D" }] });
    const t = run(j);
    await t.go();
    expect(t.calls.some((c) => c.startsWith("search"))).toBe(false);
    expect(t.store.generations[0].facts_used).toEqual(["P1"]);
  });
});
