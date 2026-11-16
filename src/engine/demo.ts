// The public homepage demo: a visitor types a company website (and, optionally, what they sell) and
// gets one example opener with its sources. Cheapest settings: the 30-day domain cache first, else 2
// pages researched; the Lite writer; plan check, rule checks and one rewrite (no judge, to stay fast).
// Hard 20-second limit. Framework-agnostic: store, reader and LLM come in, costs go out.
import { parseTemplate } from "@/lib/template";
import { allPass, failureReasons, planCheck, ruleChecks, type CheckContext } from "./checks";
import type { EngineConfig } from "./config";
import type { WebReader } from "./firecrawl";
import { detectLanguage } from "./language";
import { LLMRefusalError, type LLM } from "./llm";
import { researchDomain } from "./research";
import { LIVE_SKILL_VERSION } from "./skills";
import type { EngineStore } from "./store";
import type { CostEntry, Fact, WriterOutput } from "./types";

export const DEMO_TIMEOUT_MS = 20_000;
export const MAX_SELLS_CHARS = 140;

export type DemoInput = { domain: string; sells?: string | null };
export type DemoSource = { n: number; id: string; text: string; url: string };
export type DemoResult =
  | { status: "done"; domain: string; opener: string; sources: DemoSource[]; cached: boolean }
  | { status: "no_facts"; domain: string; reason: string; cached: boolean }
  | { status: "failed" | "timeout"; domain: string; reason: string };

export type DemoDeps = { store: EngineStore; reader: WebReader; llm: LLM; config: EngineConfig; now?: () => Date; timeoutMs?: number };

/** The visitor's "what you sell" line, made safe to put into the email (no slot or variable syntax, one line). */
export function cleanSells(sells: string | null | undefined): string {
  return (sells ?? "")
    .replace(/\[\[|\]\]|\{\{|\}\}/g, "")
    .replace(/[\r\n\t]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, MAX_SELLS_CHARS);
}

export function demoTemplate(sells: string) {
  const about = sells ? `What we do: ${sells.replace(/\.$/, "")}.` : "We help companies like yours with their outreach.";
  return {
    subject: "Quick question",
    body: `Hi,\n\n[[opener · one sentence about something specific and recent on their own website, said the way a peer would · 25]]\n\n${about}\n\nBest regards`,
  };
}

const days = (d: Date, n: number) => new Date(d.getTime() + n * 86_400_000).toISOString();

/** Facts for a domain: the shared 30-day cache, else research 2 pages and extract (then cached for campaigns too). */
async function demoFacts(domain: string, deps: DemoDeps, costs: CostEntry[]): Promise<{ facts: Fact[]; cached: boolean; status: string }> {
  const now = deps.now?.() ?? new Date();
  const cached = await deps.store.getCachedResearch(domain);
  if (cached && new Date(cached.expires_at) > now && (cached.status !== "ok" || cached.extractor === deps.llm.extractorId)) {
    return { facts: cached.facts, cached: true, status: cached.status };
  }
  const r = await researchDomain(domain, { reader: deps.reader, config: deps.config, lite: true, website: domain });
  costs.push(...r.costs);
  const pages = r.pages.map(({ url, type, md_hash, title }) => ({ url, type, md_hash, title }));
  if (r.status !== "ok") {
    await deps.store.saveResearch({ domain, pages, facts: [], status: r.status, extractor: deps.llm.extractorId, researched_at: now.toISOString(), expires_at: days(now, deps.config.research.negativeCacheDays) });
    return { facts: [], cached: false, status: r.status };
  }
  const ex = await deps.llm.extractFacts({ company: null, domain, pages: r.pages });
  costs.push(...ex.costs);
  await deps.store.saveResearch({
    domain,
    pages,
    facts: ex.output.facts,
    status: "ok",
    extractor: deps.llm.extractorId,
    researched_at: now.toISOString(),
    expires_at: days(now, ex.output.facts.length ? deps.config.research.cacheDays : deps.config.research.negativeCacheDays),
  });
  return { facts: ex.output.facts, cached: false, status: "ok" };
}

const NO_FACTS_REASON: Record<string, string> = {
  unreachable: "We couldn't reach this website.",
  blocked: "This website asks robots not to read its pages, so we don't.",
  refused: "This website blocks automated reading.",
  no_content: "This website had no readable text.",
  ok: "We didn't find anything specific enough on this website.",
};

async function run(input: DemoInput, deps: DemoDeps, costs: CostEntry[]): Promise<DemoResult> {
  const { domain } = input;
  const f = await demoFacts(domain, deps, costs);
  if (!f.facts.length) {
    return { status: "no_facts", domain, cached: f.cached, reason: `${NO_FACTS_REASON[f.status] ?? NO_FACTS_REASON.ok} In a real campaign this lead would get a neutral line and cost 0 credits.` };
  }
  const sells = cleanSells(input.sells);
  const t = demoTemplate(sells);
  const tpl = parseTemplate(t);
  const language = detectLanguage(sells || t.body);
  const ctx: CheckContext = { slots: tpl.slots, facts: f.facts, language, skillVersion: LIVE_SKILL_VERSION, company: null };
  let feedback: string[] | undefined;
  let previous: WriterOutput | undefined;
  let last: WriterOutput | null = null;
  for (let attempt = 1; attempt <= 2; attempt++) {
    const w = await deps.llm.write({
      writer: "lite",
      skillVersion: LIVE_SKILL_VERSION,
      language,
      template: { subject: t.subject, body: t.body, slots: tpl.slots },
      styleRules: { language },
      facts: f.facts,
      lead: { first_name: null, company: null, title: null, linkedin_headline: null },
      examples: [],
      feedback,
      previous,
      personal: [],
    });
    costs.push(...w.costs);
    const checks = [...planCheck(w.output, ctx), ...ruleChecks(w.output, ctx)];
    last = w.output;
    if (allPass(checks)) break;
    feedback = failureReasons(checks);
    previous = w.output;
  }
  const opener = last?.slots.opener?.trim();
  if (!opener) return { status: "failed", domain, reason: "The example couldn't be written. Try another website." };
  const used = (last?.facts_used ?? []).map((id) => f.facts.find((x) => x.id === id)).filter((x): x is Fact => !!x && x.src !== "csv");
  const sources = used.map((x, i) => ({ n: i + 1, id: x.id, text: x.text, url: x.src }));
  return { status: "done", domain, opener, sources, cached: f.cached };
}

/** Run the demo with a hard time limit. `costs` collects every paid call, also when it times out. */
export async function runDemo(input: DemoInput, deps: DemoDeps, costs: CostEntry[] = []): Promise<DemoResult> {
  const limit = deps.timeoutMs ?? DEMO_TIMEOUT_MS;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<DemoResult>((resolve) => {
    timer = setTimeout(() => resolve({ status: "timeout", domain: input.domain, reason: "This website took too long to read. Try another one, or try again in a minute." }), limit);
  });
  try {
    return await Promise.race([
      run(input, deps, costs).catch((e): DemoResult => {
        if (e instanceof LLMRefusalError) return { status: "failed", domain: input.domain, reason: "The example couldn't be written for this website." };
        return { status: "failed", domain: input.domain, reason: "Something went wrong reading this website. Try another one." };
      }),
      timeout,
    ]);
  } finally {
    clearTimeout(timer);
  }
}
