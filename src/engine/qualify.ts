// Lead qualification (Part B): before writing, the fast model checks the company against the
// campaign's target customer. Provider-independent rules live here:
//   - only website facts, company, domain and job title go in (no names, emails or profile links);
//   - the answer is validated: cited fact ids must exist, and "no_fit" must cite at least one fact.
//     An answer that breaks a rule is retried once with the reason; still broken → "unsure";
//   - no facts → "unsure" without an AI call;
//   - what happens next depends on the campaign's strictness (decide()).
import { createHash } from "node:crypto";
import { LLMInvalidOutputError, LLMRefusalError, type LLM, type QualifyOutput, type Strictness, type TargetCustomer } from "./llm";
import type { CostEntry, Fact } from "./types";

export type { Verdict } from "@/lib/target-customer";
import type { Verdict } from "@/lib/target-customer";

/** What is stored on the lead and in the per-campaign cache. */
export type Qualification = {
  verdict: Verdict;
  reason: string;
  facts: string[];
  criteria: { met: string[]; not_met: string[] };
  /** The cited facts with their text and page, so the customer sees what the verdict rests on. */
  cited: { id: string; text: string; src: string }[];
  /** False when the AI gave no usable answer: such a verdict is not cached, so a later run asks again. */
  cacheable: boolean;
};


/** Qualification is on when the campaign describes who fits or who doesn't. */
export function targetActive(t: TargetCustomer | null | undefined): t is TargetCustomer {
  return !!t && (t.fits.trim().length > 0 || t.excludes.trim().length > 0);
}

/** Cache fingerprint of the target text. Strictness only changes what we do with a verdict, not the verdict. */
export function targetHash(t: TargetCustomer): string {
  const norm = (s: string) => s.trim().replace(/\s+/g, " ").toLowerCase();
  return createHash("sha256").update(JSON.stringify([norm(t.fits), norm(t.excludes)])).digest("hex").slice(0, 32);
}

export const NO_FACTS_REASON = "Not enough information on their website to judge.";
const FAILED_REASON = "The fit check didn't give a clear answer.";

export const unsure = (reason: string, cacheable = true): Qualification => ({ verdict: "unsure", reason, facts: [], criteria: { met: [], not_met: [] }, cited: [], cacheable });

/** Why an answer can't be accepted, or null when it can. */
export function problemWith(out: QualifyOutput, factIds: Set<string>): string | null {
  const unknown = out.fact_ids.filter((id) => !factIds.has(id));
  if (unknown.length) return `fact ids ${unknown.join(", ")} are not in the list.`;
  if (out.verdict === "no_fit" && out.fact_ids.length === 0) return `"no_fit" must cite at least one fact id that shows it.`;
  if (!out.reason.trim()) return `"reason" is empty.`;
  return null;
}

const clip = (s: string, n: number) => (s.length > n ? `${s.slice(0, n - 1).trimEnd()}…` : s);
function toQualification(out: QualifyOutput, facts: Fact[]): Qualification {
  const ids = [...new Set(out.fact_ids)].slice(0, 6);
  return {
    verdict: out.verdict,
    reason: clip(out.reason.trim().replace(/\s+/g, " "), 300),
    facts: ids,
    criteria: { met: out.criteria_met.slice(0, 8).map((c) => clip(c, 120)), not_met: out.criteria_not_met.slice(0, 8).map((c) => clip(c, 120)) },
    cited: ids.map((id) => facts.find((f) => f.id === id)!).map((f) => ({ id: f.id, text: f.text, src: f.src })),
    cacheable: true,
  };
}

/**
 * One qualification with validation and one retry. Never throws for a bad or declined answer (that
 * is "unsure"); a missing or invalid key (LLMUnavailableError) is passed on, as for every AI step.
 */
export async function qualifyLead(
  llm: LLM,
  input: { target: TargetCustomer; company: string | null; domain: string; title: string | null; facts: Fact[]; personal: string[] },
): Promise<{ result: Qualification; costs: CostEntry[]; aiCalled: boolean }> {
  const facts = input.facts.filter((f) => f.tier === "A");
  if (facts.length === 0) return { result: unsure(NO_FACTS_REASON), costs: [], aiCalled: false };
  const ids = new Set(facts.map((f) => f.id));
  const costs: CostEntry[] = [];
  let feedback: string | undefined;
  for (let attempt = 1; attempt <= 2; attempt++) {
    try {
      const r = await llm.qualify({ ...input, facts, feedback });
      costs.push(...r.costs);
      const problem = problemWith(r.output, ids);
      if (!problem) return { result: toQualification(r.output, facts), costs, aiCalled: true };
      feedback = problem;
    } catch (e) {
      if (e instanceof LLMInvalidOutputError) {
        costs.push(...e.costs);
        return { result: unsure(FAILED_REASON, false), costs, aiCalled: true };
      }
      if (e instanceof LLMRefusalError) return { result: unsure(FAILED_REASON, false), costs, aiCalled: true };
      throw e;
    }
  }
  return { result: unsure(FAILED_REASON, false), costs, aiCalled: true };
}

/**
 * What the pipeline does with a verdict:
 *   no_fit → skip (0 credits); unsure → strict: skip, normal: write and flag, loose: write; fit → write.
 */
export function decide(verdict: Verdict, strictness: Strictness): { write: boolean; flag: boolean } {
  if (verdict === "no_fit") return { write: false, flag: false };
  if (verdict === "unsure") return strictness === "strict" ? { write: false, flag: false } : { write: true, flag: strictness === "normal" };
  return { write: true, flag: false };
}

/** The status line a skipped lead shows. */
export function skipDetail(q: Qualification): string {
  return q.verdict === "no_fit" ? `Not a fit: ${q.reason}` : `Unsure fit (strict): ${q.reason}`;
}

export { NO_FIT_WARNING, noFitWarning } from "@/lib/target-customer";
