// Quality Lab v1 (§7.4): a fixed test set; a candidate skill version and the baseline
// both write for every test lead from the same facts; code checks, the AI judge and a
// side-by-side comparison decide. Only ship a version that wins clearly.
// Framework-agnostic: research uses the domain cache through EngineStore.
import { hasErrors, parseTemplate, render } from "@/lib/template";
import type { StyleRules } from "@/lib/types";
import { allPass, failureReasons, planCheck, ruleChecks, type CheckContext } from "./checks";
import type { EngineConfig } from "./config";
import { totalCost } from "./costs";
import type { WebReader } from "./firecrawl";
import { detectLanguage } from "./language";
import { LLMRefusalError, type LLM } from "./llm";
import { researchDomain } from "./research";
import type { EngineStore } from "./store";
import type { CostEntry, Fact, JudgeScores, WriterOutput } from "./types";

export type TestLead = { first_name: string | null; company: string | null; title: string | null; domain: string; website?: string | null };
export type TestSet = { id: string; name: string; template: { subject: string; body: string; style_rules?: StyleRules }; leads: TestLead[] };

export type Side = { slots: Record<string, string> | null; email: string | null; passed: boolean; failed: string[]; judgeAvg: number | null; error?: string };
export type LeadResult = { company: string | null; domain: string; facts: number; candidate: Side; baseline: Side; winner: "candidate" | "baseline" | "tie" | "skipped"; reason: string };
export type EvalSummary = {
  wins: number;
  losses: number;
  ties: number;
  skipped: number;
  judgeAvg: number | null;
  baselineJudgeAvg: number | null;
  ruleFailRate: number | null;
  baselineRuleFailRate: number | null;
  verdict: "ship" | "no" | "inconclusive";
  verdictText: string;
};

export const MAX_TEST_LEADS = 100;
/** "Wins clearly": at least 60% of the decided comparisons, on at least 10 decided leads, and no more rule failures. */
export const WIN_SHARE = 0.6;
export const MIN_DECIDED = 10;

export type LabDeps = { store: EngineStore; reader: WebReader; llm: LLM; config: EngineConfig; random?: () => number };

const judgeAverage = (j: JudgeScores) => (j.relevance + j.specificity + j.value_clarity + j.cta_effort + j.sounds_human + j.would_reply) / 6;

/** Facts for a domain, from the 30-day cache when possible (same cache as campaigns). */
async function factsFor(lead: TestLead, deps: LabDeps, costs: CostEntry[]): Promise<Fact[]> {
  const cached = await deps.store.getCachedResearch(lead.domain);
  const usable = cached && new Date(cached.expires_at) > new Date() && (cached.status !== "ok" || cached.extractor === deps.llm.extractorId);
  if (usable) return cached.facts;
  const r = await researchDomain(lead.domain, { reader: deps.reader, config: deps.config, website: lead.website ?? null });
  costs.push(...r.costs);
  const now = new Date();
  const pages = r.pages.map(({ url, type, md_hash, title }) => ({ url, type, md_hash, title }));
  if (r.status !== "ok") {
    await deps.store.saveResearch({ domain: lead.domain, pages, facts: [], status: r.status, extractor: deps.llm.extractorId, researched_at: now.toISOString(), expires_at: new Date(now.getTime() + deps.config.research.negativeCacheDays * 86_400_000).toISOString() });
    return [];
  }
  const ex = await deps.llm.extractFacts({ company: lead.company, domain: lead.domain, pages: r.pages });
  costs.push(...ex.costs);
  await deps.store.saveResearch({
    domain: lead.domain,
    pages,
    facts: ex.output.facts,
    status: "ok",
    extractor: deps.llm.extractorId,
    researched_at: now.toISOString(),
    expires_at: new Date(now.getTime() + (ex.output.facts.length ? deps.config.research.cacheDays : deps.config.research.negativeCacheDays) * 86_400_000).toISOString(),
  });
  return ex.output.facts;
}

/** One lead through the full write loop (one rewrite) for one skill version. */
async function writeSide(version: string, lead: TestLead, facts: Fact[], set: TestSet, deps: LabDeps, costs: CostEntry[]): Promise<Side> {
  const tpl = parseTemplate({ subject: set.template.subject, body: set.template.body });
  const rules = set.template.style_rules ?? {};
  const language = rules.language && rules.language !== "auto" ? rules.language : detectLanguage(set.template.body);
  const ctx: CheckContext = { slots: tpl.slots, facts, language, skillVersion: version, extraBanned: rules.banned_phrases, company: lead.company };
  const vars = { first_name: lead.first_name, company: lead.company, title: lead.title, domain: lead.domain, website: lead.website ?? lead.domain };
  let feedback: string[] | undefined;
  let previous: WriterOutput | undefined;
  let last: { out: WriterOutput; failed: string[]; judge: JudgeScores | null } | null = null;
  try {
    for (let attempt = 1; attempt <= 2; attempt++) {
      const w = await deps.llm.write({
        writer: "pro",
        skillVersion: version,
        language,
        template: { subject: set.template.subject, body: set.template.body, slots: tpl.slots },
        styleRules: rules,
        facts,
        lead: { first_name: lead.first_name, company: lead.company, title: lead.title, linkedin_headline: null },
        examples: [],
        feedback,
        previous,
      });
      costs.push(...w.costs);
      const checks = [...planCheck(w.output, ctx), ...ruleChecks(w.output, ctx)];
      const email = render(tpl.body, vars, w.output.slots).replace(/\n{3,}/g, "\n\n").trim();
      let judge: JudgeScores | null = null;
      if (allPass(checks)) {
        const j = await deps.llm.judge({ language, slots: w.output.slots, facts, emailPreview: email, role: lead.title });
        costs.push(...j.costs);
        judge = j.output;
        const ok = judgeAverage(judge) >= deps.config.quality.judgePassAvg && judge.claims_supported;
        if (ok) return { slots: w.output.slots, email, passed: true, failed: [], judgeAvg: judgeAverage(judge) };
        checks.push({ id: "judge", label: "AI judge", pass: false, detail: `avg ${judgeAverage(judge).toFixed(1)}` });
      }
      last = { out: w.output, failed: failureReasons(checks), judge };
      feedback = failureReasons(checks);
      previous = w.output;
    }
  } catch (e) {
    if (e instanceof LLMRefusalError) return { slots: null, email: null, passed: false, failed: [], judgeAvg: null, error: "The model declined" };
    throw e;
  }
  return {
    slots: last?.out.slots ?? null,
    email: last ? render(tpl.body, vars, last.out.slots).replace(/\n{3,}/g, "\n\n").trim() : null,
    passed: false,
    failed: last?.failed ?? [],
    judgeAvg: last?.judge ? judgeAverage(last.judge) : null,
  };
}

/** Candidate vs baseline on one lead. The order shown to the comparing model is random (no position bias). */
export async function evalLead(lead: TestLead, set: TestSet, versions: { candidate: string; baseline: string }, deps: LabDeps): Promise<{ result: LeadResult; costs: CostEntry[] }> {
  const costs: CostEntry[] = [];
  const facts = await factsFor(lead, deps, costs);
  const empty: Side = { slots: null, email: null, passed: false, failed: [], judgeAvg: null };
  if (facts.length === 0) {
    return { result: { company: lead.company, domain: lead.domain, facts: 0, candidate: empty, baseline: empty, winner: "skipped", reason: "No usable facts on the website" }, costs };
  }
  const candidate = await writeSide(versions.candidate, lead, facts, set, deps, costs);
  const baseline = await writeSide(versions.baseline, lead, facts, set, deps, costs);
  let winner: LeadResult["winner"];
  let reason: string;
  if (candidate.passed !== baseline.passed) {
    winner = candidate.passed ? "candidate" : "baseline";
    reason = "Only one version passed the checks and the judge";
  } else if (!candidate.passed) {
    winner = "tie";
    reason = "Neither version passed the checks";
  } else if (!deps.llm.compare) {
    winner = "tie";
    reason = "No comparing model available";
  } else {
    const swap = (deps.random ?? Math.random)() < 0.5;
    const lines = (s: Side) => Object.entries(s.slots ?? {}).map(([k, v]) => `${k}: ${v}`).join("\n");
    const c = await deps.llm.compare({
      language: detectLanguage(set.template.body),
      facts,
      role: lead.title,
      a: lines(swap ? baseline : candidate),
      b: lines(swap ? candidate : baseline),
    });
    costs.push(...c.costs);
    const w = c.output.winner;
    winner = w === "tie" ? "tie" : (w === "a") !== swap ? "candidate" : "baseline";
    reason = c.output.reason;
  }
  return { result: { company: lead.company, domain: lead.domain, facts: facts.length, candidate, baseline, winner, reason }, costs };
}

export function summarise(results: LeadResult[]): EvalSummary {
  const decided = results.filter((r) => r.winner === "candidate" || r.winner === "baseline");
  const wins = results.filter((r) => r.winner === "candidate").length;
  const losses = results.filter((r) => r.winner === "baseline").length;
  const ties = results.filter((r) => r.winner === "tie").length;
  const skipped = results.filter((r) => r.winner === "skipped").length;
  const ran = results.filter((r) => r.winner !== "skipped");
  const avg = (xs: (number | null)[]) => {
    const v = xs.filter((x): x is number => x != null);
    return v.length ? Math.round((v.reduce((a, b) => a + b, 0) / v.length) * 100) / 100 : null;
  };
  const failRate = (pick: (r: LeadResult) => Side) => (ran.length ? Math.round((ran.filter((r) => !pick(r).passed).length / ran.length) * 1000) / 1000 : null);
  const ruleFailRate = failRate((r) => r.candidate);
  const baselineRuleFailRate = failRate((r) => r.baseline);
  let verdict: EvalSummary["verdict"] = "inconclusive";
  let verdictText = `Too few decided comparisons (${decided.length} of at least ${MIN_DECIDED}) to call it.`;
  if (decided.length >= MIN_DECIDED) {
    const share = wins / decided.length;
    const notWorse = (ruleFailRate ?? 0) <= (baselineRuleFailRate ?? 0);
    if (share >= WIN_SHARE && notWorse) {
      verdict = "ship";
      verdictText = `Candidate wins ${Math.round(share * 100)}% of decided comparisons without more failed checks: ready to ship.`;
    } else {
      verdict = "no";
      verdictText = notWorse
        ? `Candidate wins ${Math.round(share * 100)}% of decided comparisons; it needs ${Math.round(WIN_SHARE * 100)}% to ship.`
        : "Candidate fails the checks more often than the baseline: don't ship.";
    }
  }
  return {
    wins,
    losses,
    ties,
    skipped,
    judgeAvg: avg(ran.map((r) => r.candidate.judgeAvg)),
    baselineJudgeAvg: avg(ran.map((r) => r.baseline.judgeAvg)),
    ruleFailRate,
    baselineRuleFailRate,
    verdict,
    verdictText,
  };
}

/** Run a whole test set, one lead at a time (onProgress after each, so a page can follow along). */
export async function runEval(
  set: TestSet,
  versions: { candidate: string; baseline: string },
  deps: LabDeps,
  onProgress?: (done: LeadResult[], costUsd: number) => Promise<void>,
): Promise<{ results: LeadResult[]; summary: EvalSummary; costUsd: number }> {
  const tpl = parseTemplate({ subject: set.template.subject, body: set.template.body });
  if (hasErrors(tpl) || tpl.slots.length === 0) throw new Error("The test set's template has errors or no slots.");
  const results: LeadResult[] = [];
  const costs: CostEntry[] = [];
  for (const lead of set.leads.slice(0, MAX_TEST_LEADS)) {
    const r = await evalLead(lead, set, versions, deps);
    results.push(r.result);
    costs.push(...r.costs);
    await onProgress?.(results, totalCost(costs));
  }
  return { results, summary: summarise(results), costUsd: totalCost(costs) };
}
