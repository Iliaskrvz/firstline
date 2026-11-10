// The per-lead pipeline (§4). One lead = one job. Idempotent: a settled lead is
// never processed twice unless forced (preview regenerate).
//   research (or cache) -> extract facts -> write (plan first) -> validate
//   -> one rewrite on failure -> fallback -> save generation + costs.
// Credits (reserve/capture/release) are wired in Phase 5; previews are free.
import { hasErrors, parseTemplate, render } from "@/lib/template";
import { allPass, failureReasons, planCheck, ruleChecks, type CheckContext } from "./checks";
import type { EngineConfig } from "./config";
import { totalCost } from "./costs";
import { fallbackSlots, FALLBACK_REASONS, type FallbackReason } from "./fallback";
import type { WebReader } from "./firecrawl";
import { detectLanguage } from "./language";
import { LLMRefusalError, LLMUnavailableError, type LLM } from "./llm";
import type { Semaphore } from "./limiter";
import { SKILL_VERSION } from "./prompts/skill-v1";
import { researchDomain } from "./research";
import type { CachedResearch, EngineStore } from "./store";
import type { CheckItem, CostEntry, Fact, JudgeScores, Language, LeadJob, WriterOutput } from "./types";

export type PipelineDeps = {
  store: EngineStore;
  reader: WebReader;
  llm: LLM;
  config: EngineConfig;
  firecrawlGate?: Semaphore;
  now?: () => Date;
};

export type PipelineOutcome = { outcome: "done" | "fallback" | "failed" | "skipped" | "missing"; detail?: string; costUsd: number };

const SETTLED = new Set(["done", "fallback", "skipped"]);
const days = (d: Date, n: number) => new Date(d.getTime() + n * 86_400_000).toISOString();

export function roleFacts(lead: LeadJob["lead"]): Fact[] {
  const out: Fact[] = [];
  if (lead.title) out.push({ id: "C1", text: `Their role: ${lead.title}`, src: "csv", tier: "C" });
  if (lead.linkedin_headline) out.push({ id: `C${out.length + 1}`, text: `Their professional headline: ${lead.linkedin_headline}`, src: "csv", tier: "C" });
  return out;
}

export function leadVars(lead: LeadJob["lead"]): Record<string, string | null> {
  const { email, first_name, last_name, company, title, linkedin_headline, website, domain } = lead;
  return { ...(lead.custom ?? {}), email, first_name, last_name, company, title, linkedin_headline, website, domain };
}

/** Is a cache row usable for this extractor? Failed sites are reused by anyone. */
export function cacheUsable(row: CachedResearch | null, extractorId: string, now: Date): boolean {
  if (!row || new Date(row.expires_at) <= now) return false;
  return row.status !== "ok" || row.extractor === extractorId;
}

export async function processLead(leadId: string, deps: PipelineDeps, opts: { preview?: boolean; force?: boolean } = {}): Promise<PipelineOutcome> {
  const { store, llm, config } = deps;
  const now = deps.now ?? (() => new Date());
  const spent: CostEntry[] = [];

  const job = await store.loadLeadJob(leadId);
  if (!job) return { outcome: "missing", costUsd: 0 };
  const { lead } = job;
  if (!opts.force && SETTLED.has(lead.status)) return { outcome: "skipped", detail: `already ${lead.status}`, costUsd: 0 };

  const log = async (costs: CostEntry[]) => {
    if (!costs.length) return;
    spent.push(...costs);
    await store.logCosts(lead.id, lead.workspace_id, costs);
  };
  const fail = async (detail: string, research: unknown = {}) => {
    await store.setLeadStatus(lead.id, "failed", { detail, confidence: null });
    if (research && Object.keys(research as object).length) {
      await store.saveGeneration({
        lead_id: lead.id, workspace_id: lead.workspace_id, plan: null, slot_outputs: {}, full_email: "", subject: "", facts_used: [],
        skill_version: null, checks: { status: "failed", detail }, judge_scores: {}, research, provider: llm.provider, is_preview: !!opts.preview, attempts: 0,
      });
    }
    return { outcome: "failed" as const, detail, costUsd: totalCost(spent) };
  };

  if (!job.template) return fail("The campaign has no template");
  const tpl = parseTemplate({ subject: job.template.subject, body: job.template.body });
  if (hasErrors(tpl) || tpl.slots.length === 0) return fail("The template has errors or no slots");
  const rules = job.template.style_rules ?? {};
  const language: Language = rules.language && rules.language !== "auto" ? rules.language : detectLanguage(job.template.body);
  const vars = leadVars(lead);
  const renderEmail = (slots: Record<string, string>) => ({
    subject: render(tpl.subject, vars, slots).trim(),
    body: render(tpl.body, vars, slots).replace(/[ \t]+\n/g, "\n").replace(/\n{3,}/g, "\n\n").trim(),
  });

  /**
   * Personalised follow-ups (steps 2+), from the same facts as step 1, so no new research.
   * Without usable facts (or if writing fails) a step gets the neutral fallback; it never fails the lead.
   */
  const writeFollowUps = async (stepFacts: Fact[] | null, firstEmail: string) => {
    for (const step of job.followUps ?? []) {
      const ftpl = parseTemplate({ subject: "", body: step.body });
      if (hasErrors(ftpl) || ftpl.slots.length === 0) continue; // validated when the step was saved
      const renderBody = (slots: Record<string, string>) =>
        render(ftpl.body, vars, slots).replace(/[ \t]+\n/g, "\n").replace(/\n{3,}/g, "\n\n").trim();
      let result: { slots: Record<string, string>; plan: unknown; factsUsed: string[]; checks: unknown; attempts: number } | null = null;
      if (stepFacts) {
        const fctx: CheckContext = { slots: ftpl.slots, facts: stepFacts, language, skillVersion: SKILL_VERSION, extraBanned: rules.banned_phrases, company: lead.company };
        let feedback: string[] | undefined;
        let previous: WriterOutput | undefined;
        try {
          for (let attempt = 1; attempt <= 2 && !result; attempt++) {
            const w = await llm.write({
              writer: job.campaign.writer, skillVersion: SKILL_VERSION, language, template: { subject: "", body: step.body, slots: ftpl.slots },
              styleRules: rules, facts: stepFacts, lead: { first_name: lead.first_name, company: lead.company, title: lead.title, linkedin_headline: lead.linkedin_headline },
              examples: [], feedback, previous, followUp: { stepNo: step.step_no, firstEmail },
            });
            await log(w.costs);
            const checks = [...planCheck(w.output, fctx), ...ruleChecks(w.output, fctx)];
            if (allPass(checks)) {
              result = { slots: w.output.slots, plan: w.output.plan, factsUsed: w.output.facts_used, checks: { status: "passed", items: checks, attempts: attempt }, attempts: attempt };
            } else {
              feedback = failureReasons(checks);
              previous = w.output;
            }
          }
        } catch (e) {
          if (!(e instanceof LLMUnavailableError || e instanceof LLMRefusalError)) throw e;
        }
      }
      const slots = result?.slots ?? fallbackSlots(ftpl.slots, language);
      await store.saveGeneration({
        lead_id: lead.id, workspace_id: lead.workspace_id, step_no: step.step_no, plan: result?.plan ?? null, slot_outputs: slots,
        full_email: renderBody(slots), subject: "", facts_used: result?.factsUsed ?? [], skill_version: SKILL_VERSION,
        checks: result?.checks ?? { status: "fallback", reason: stepFacts ? "failed_checks" : "no_facts" }, judge_scores: {}, research: {},
        provider: llm.provider, is_preview: !!opts.preview, attempts: result?.attempts ?? 0,
      });
    }
  };

  const fallback = async (reason: FallbackReason, research: unknown, extra: Record<string, unknown> = {}) => {
    const slots = fallbackSlots(tpl.slots, language);
    const email = renderEmail(slots);
    await store.saveGeneration({
      lead_id: lead.id, workspace_id: lead.workspace_id, plan: null, slot_outputs: slots, full_email: email.body, subject: email.subject,
      facts_used: [], skill_version: SKILL_VERSION, checks: { status: "fallback", reason, ...extra }, judge_scores: {}, research,
      provider: llm.provider, is_preview: !!opts.preview, attempts: (extra.attempts as number) ?? 0,
    });
    await writeFollowUps(null, email.body);
    await store.setLeadStatus(lead.id, "fallback", { detail: FALLBACK_REASONS[reason], confidence: "low" });
    return { outcome: "fallback" as const, detail: FALLBACK_REASONS[reason], costUsd: totalCost(spent) };
  };

  await store.setLeadStatus(lead.id, "researching", { detail: null });

  if (!lead.domain) return fallback("no_website", { status: "no_website", pages: [], facts: [] });

  // --- Research (cache first) ------------------------------------------------
  let facts: Fact[];
  let research: Record<string, unknown>;
  const cached = await store.getCachedResearch(lead.domain);
  if (cacheUsable(cached, llm.extractorId, now())) {
    facts = cached!.facts;
    research = { status: cached!.status, cached: true, researched_at: cached!.researched_at, pages: cached!.pages, facts };
    if (cached!.status !== "ok") return fallback(cached!.status, research);
  } else {
    const r = await researchDomain(lead.domain, { reader: deps.reader, config, lite: job.campaign.writer === "lite", gate: deps.firecrawlGate, website: lead.website });
    await log(r.costs);
    const pagesMeta = r.pages.map(({ url, type, md_hash, title }) => ({ url, type, md_hash, title }));
    research = { status: r.status, cached: false, picked: r.picked, pages: pagesMeta, notes: r.notes, facts: [] };
    if (r.status !== "ok") {
      await store.saveResearch({
        domain: lead.domain, pages: pagesMeta, facts: [], status: r.status, extractor: llm.extractorId,
        researched_at: now().toISOString(), expires_at: days(now(), config.research.negativeCacheDays),
      });
      return fallback(r.status, research);
    }
    try {
      const ex = await llm.extractFacts({ company: lead.company, domain: lead.domain, pages: r.pages });
      await log(ex.costs);
      facts = ex.output.facts;
    } catch (e) {
      if (e instanceof LLMUnavailableError) return fail(e.reason, { ...research, ai: e.reason });
      if (e instanceof LLMRefusalError) return fallback("refusal", research);
      throw e;
    }
    research.facts = facts;
    await store.saveResearch({
      domain: lead.domain, pages: pagesMeta, facts, status: "ok", extractor: llm.extractorId, researched_at: now().toISOString(),
      expires_at: days(now(), facts.length ? config.research.cacheDays : config.research.negativeCacheDays),
    });
  }
  if (facts.length === 0) return fallback("no_facts", research);

  // --- Write + validate, one rewrite --------------------------------------------
  const allFacts = [...facts, ...roleFacts(lead)];
  const ctx: CheckContext = { slots: tpl.slots, facts: allFacts, language, skillVersion: SKILL_VERSION, extraBanned: rules.banned_phrases, company: lead.company };
  const examples = (job.template.examples ?? []).filter((e): e is string => typeof e === "string").slice(0, 3);
  await store.setLeadStatus(lead.id, "writing");

  let feedback: string[] | undefined;
  let previous: WriterOutput | undefined;
  let last: { out: WriterOutput; checks: CheckItem[]; judge: JudgeScores | null } | null = null;
  try {
    for (let attempt = 1; attempt <= 2; attempt++) {
      const w = await llm.write({
        writer: job.campaign.writer, skillVersion: SKILL_VERSION, language, template: { subject: job.template.subject, body: job.template.body, slots: tpl.slots },
        styleRules: rules, facts: allFacts, lead: { first_name: lead.first_name, company: lead.company, title: lead.title, linkedin_headline: lead.linkedin_headline },
        examples, feedback, previous,
      });
      await log(w.costs);
      const out = w.output;
      const checks = [...planCheck(out, ctx), ...ruleChecks(out, ctx)];
      let judge: JudgeScores | null = null;
      if (allPass(checks)) {
        const j = await llm.judge({ language, slots: out.slots, facts: allFacts, emailPreview: renderEmail(out.slots).body, role: lead.title });
        await log(j.costs);
        judge = j.output;
        const avg = judgeAverage(judge);
        checks.push({
          id: "judge",
          label: `AI judge average ≥ ${config.quality.judgePassAvg} and every claim backed by a fact`,
          pass: avg >= config.quality.judgePassAvg && judge.claims_supported,
          detail: `avg ${avg.toFixed(1)}${judge.unsupported_claims.length ? ` · unsupported: ${judge.unsupported_claims.join("; ")}` : ""}`,
        });
      }
      last = { out, checks, judge };
      if (allPass(checks)) {
        const email = renderEmail(out.slots);
        const avg = judge ? judgeAverage(judge) : 0;
        await store.saveGeneration({
          lead_id: lead.id, workspace_id: lead.workspace_id, plan: out.plan, slot_outputs: out.slots, full_email: email.body, subject: email.subject,
          facts_used: out.facts_used, skill_version: out.skill_version, checks: { status: "passed", items: checks, attempts: attempt },
          judge_scores: judge ?? {}, research, provider: llm.provider, is_preview: !!opts.preview, attempts: attempt,
        });
        await writeFollowUps(allFacts, email.body);
        const confidence = attempt === 1 && avg >= 4.2 ? "high" : "medium";
        await store.setLeadStatus(lead.id, "done", { detail: null, confidence });
        return { outcome: "done", costUsd: totalCost(spent) };
      }
      feedback = failureReasons(checks);
      previous = out;
    }
  } catch (e) {
    if (e instanceof LLMUnavailableError) return fail(e.reason, { ...research, ai: e.reason });
    if (e instanceof LLMRefusalError) return fallback("refusal", research);
    throw e;
  }
  return fallback("failed_checks", research, { attempts: 2, items: last?.checks ?? [], rejected: last?.out ?? null, judge: last?.judge ?? null });
}

export function judgeAverage(j: JudgeScores): number {
  const s = [j.relevance, j.specificity, j.value_clarity, j.cta_effort, j.sounds_human, j.would_reply];
  return s.reduce((a, b) => a + b, 0) / s.length;
}
