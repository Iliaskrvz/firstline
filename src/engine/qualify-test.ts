// Quality Lab: the qualification test (Part B). Leads labelled by hand ("should_fit": yes or no) are
// researched like real leads and checked with the production qualify model. The report gives the
// accuracy, the false no_fit rate (good leads we would have skipped: the costly mistake) and the cost
// per lead. Framework-agnostic: costs go out through record, and a hard budget stops the run.
import Papa from "papaparse";
import type { EngineConfig } from "./config";
import type { WebReader } from "./firecrawl";
import type { LLM, TargetCustomer } from "./llm";
import { qualifyLead, type Verdict } from "./qualify";
import { researchDomain } from "./research";
import type { CostEntry } from "./types";
import { normaliseDomain } from "@/lib/domain";
import { TARGET_MAX_CHARS } from "@/lib/target-customer";

export const QUALIFY_TEST = { minLeads: 10, maxLeads: 200, budgetUsd: 5 } as const;
export const QUALIFY_TEST_COLUMNS = ["domain", "company", "title", "target_customer", "should_fit"] as const;

export type QualifyTestLead = { domain: string; company: string | null; title: string | null; target: TargetCustomer; shouldFit: boolean };

/**
 * target_customer holds who fits, optionally followed by "Not:" and who doesn't, e.g.
 * "Independent bakeries in the Netherlands. Not: chains, wholesalers". Strictness doesn't change a verdict.
 */
export function parseTargetText(text: string): TargetCustomer {
  const [fits, ...rest] = text.split(/\bnot:\s*/i);
  return { fits: fits.trim().replace(/[.;,\s]+$/, ""), excludes: rest.join(" ").trim(), strictness: "normal" };
}

const YES = new Set(["yes", "y", "true", "1", "ja", "fit"]);
const NO = new Set(["no", "n", "false", "0", "nee", "no_fit"]);

/** Parse the CSV (template: fixtures/qualify-testset-template.csv). Errors name the row. */
export function parseQualifyCsv(csv: string): { leads: QualifyTestLead[] } | { error: string } {
  const parsed = Papa.parse<Record<string, string>>(csv.replace(/^﻿/, "").trim(), { header: true, skipEmptyLines: true, transformHeader: (h) => h.trim().toLowerCase() });
  const fields = parsed.meta.fields ?? [];
  const missing = QUALIFY_TEST_COLUMNS.filter((c) => c !== "company" && c !== "title" && !fields.includes(c));
  if (missing.length) return { error: `Missing column(s): ${missing.join(", ")}. Use the template's columns: ${QUALIFY_TEST_COLUMNS.join(", ")}.` };
  const leads: QualifyTestLead[] = [];
  for (const [i, row] of parsed.data.entries()) {
    const line = i + 2;
    const domain = normaliseDomain(row.domain ?? "");
    if (!domain) return { error: `Row ${line}: "${row.domain ?? ""}" is not a website domain.` };
    const label = (row.should_fit ?? "").trim().toLowerCase();
    if (!YES.has(label) && !NO.has(label)) return { error: `Row ${line}: should_fit must be yes or no.` };
    const text = (row.target_customer ?? "").trim();
    if (!text) return { error: `Row ${line}: target_customer is empty.` };
    if (text.length > TARGET_MAX_CHARS * 2) return { error: `Row ${line}: target_customer is too long.` };
    leads.push({ domain, company: row.company?.trim() || null, title: row.title?.trim() || null, target: parseTargetText(text), shouldFit: YES.has(label) });
  }
  if (leads.length < QUALIFY_TEST.minLeads) return { error: `Add at least ${QUALIFY_TEST.minLeads} labelled leads (about 50 is best).` };
  if (leads.length > QUALIFY_TEST.maxLeads) return { error: `At most ${QUALIFY_TEST.maxLeads} leads per test.` };
  return { leads };
}

export type QualifyTestRow = { domain: string; company: string | null; shouldFit: boolean; verdict: Verdict | null; reason: string; facts: number; costUsd: number; correct: boolean | null };
export type QualifyTestReport = {
  provider: string;
  model: string;
  leads: number;
  /** Leads with a verdict (research worked). */
  judged: number;
  /** fit on should_fit=yes and no_fit on should_fit=no, of the leads that got a fit or no_fit. */
  accuracy: number | null;
  /** Share of should_fit=yes leads judged no_fit: good leads we would have skipped. */
  falseNoFitRate: number | null;
  /** Share of should_fit=no leads judged fit: emails we would have written for nothing. */
  missedNoFitRate: number | null;
  unsureRate: number | null;
  /** Everything per judged lead: research, extraction and the check. */
  costPerLeadUsd: number | null;
  /** The qualify call alone, per judged lead. */
  qualifyCostPerLeadUsd: number | null;
  spentUsd: number;
  rows: QualifyTestRow[];
};

export type QualifyTestDeps = {
  reader: WebReader;
  llm: LLM;
  config: EngineConfig;
  budgetUsd: number;
  record: (costs: CostEntry[]) => Promise<void>;
  progress?: (p: { done: number; total: number; spentUsd: number }) => Promise<void>;
};

const rate = (n: number, d: number) => (d ? n / d : null);
const sum = (costs: CostEntry[]) => costs.reduce((s, c) => s + c.cost_usd, 0);

export async function runQualifyTest(leads: QualifyTestLead[], deps: QualifyTestDeps): Promise<{ status: "done" | "over_budget"; report: QualifyTestReport }> {
  const rows: QualifyTestRow[] = [];
  let spent = 0;
  let qualifySpent = 0;
  let status: "done" | "over_budget" = "done";
  for (const [i, lead] of leads.entries()) {
    if (spent >= deps.budgetUsd) {
      status = "over_budget";
      break;
    }
    const costs: CostEntry[] = [];
    let verdict: Verdict | null = null;
    let reason = "";
    let facts = 0;
    const r = await researchDomain(lead.domain, { reader: deps.reader, config: deps.config });
    costs.push(...r.costs);
    if (r.status !== "ok") reason = `Research: ${r.status}`;
    else {
      try {
        const ex = await deps.llm.extractFacts({ company: lead.company, domain: lead.domain, pages: r.pages, personal: [] });
        costs.push(...ex.costs);
        facts = ex.output.facts.length;
        const q = await qualifyLead(deps.llm, { target: lead.target, company: lead.company, domain: lead.domain, title: lead.title, facts: ex.output.facts, personal: [] });
        costs.push(...q.costs);
        qualifySpent += sum(q.costs);
        verdict = q.result.verdict;
        reason = q.result.reason;
      } catch (e) {
        reason = `Error: ${(e as Error).message.slice(0, 200)}`;
      }
    }
    await deps.record(costs);
    spent += sum(costs);
    const correct = verdict === "fit" ? lead.shouldFit : verdict === "no_fit" ? !lead.shouldFit : null;
    rows.push({ domain: lead.domain, company: lead.company, shouldFit: lead.shouldFit, verdict, reason, facts, costUsd: sum(costs), correct });
    await deps.progress?.({ done: i + 1, total: leads.length, spentUsd: spent });
  }
  return { status, report: summariseQualifyTest(rows, { provider: deps.llm.provider, model: deps.config.models.qualify.model, spentUsd: spent, qualifySpentUsd: qualifySpent }) };
}

export function summariseQualifyTest(rows: QualifyTestRow[], meta: { provider: string; model: string; spentUsd: number; qualifySpentUsd: number }): QualifyTestReport {
  const judged = rows.filter((r) => r.verdict);
  const decided = judged.filter((r) => r.verdict !== "unsure");
  const yes = judged.filter((r) => r.shouldFit);
  const no = judged.filter((r) => !r.shouldFit);
  return {
    provider: meta.provider,
    model: meta.model,
    leads: rows.length,
    judged: judged.length,
    accuracy: rate(decided.filter((r) => r.correct).length, decided.length),
    falseNoFitRate: rate(yes.filter((r) => r.verdict === "no_fit").length, yes.length),
    missedNoFitRate: rate(no.filter((r) => r.verdict === "fit").length, no.length),
    unsureRate: rate(judged.filter((r) => r.verdict === "unsure").length, judged.length),
    costPerLeadUsd: judged.length ? meta.spentUsd / judged.length : null,
    qualifyCostPerLeadUsd: judged.length ? meta.qualifySpentUsd / judged.length : null,
    spentUsd: meta.spentUsd,
    rows,
  };
}
