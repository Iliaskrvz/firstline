// Model bake-off (Quality Lab). Every writer candidate writes from the same facts; the test-set judge
// scores each email and compares each candidate with the baseline writer, blind and in both orders. A
// cheaper judge compares the same pairs, to see how often it agrees. Extraction: two models on the first
// leads, each fact checked against its page. Candidates per provider: src/config/models.ts (bakeoffSetup).
// Framework-agnostic: models come in through llmFor, every cost goes out through record.
// A hard budget stops the run before it can go over; after a short pilot the whole run is projected.
import { BAKEOFF, bakeoffSetup, providerOf, type BakeoffSetup, type StepModel, type StepModels } from "@/config/models";
import { usdToEur } from "@/lib/admin";
import { enabledPacks } from "@/lib/credits";
import { parseTemplate, render } from "@/lib/template";
import type { StyleRules } from "@/lib/types";
import { allPass, failureReasons, planCheck, ruleChecks, type CheckContext } from "./checks";
import type { EngineConfig } from "./config";
import type { WebReader } from "./firecrawl";
import { detectLanguage } from "./language";
import { LLMRefusalError, type LLM, type WriteInput } from "./llm";
import { personalValues } from "./privacy";
import { researchDomain } from "./research";
import type { TestLead, TestSet } from "./lab";
import type { CostEntry, Fact, JudgeScores, Language, WriterOutput } from "./types";

export type BakeoffLead = TestLead & { setId: string };
/** A writer key from the provider's bake-off setup (e.g. "pro", "flash", "pro_offpeak"). */
export type BakeoffWriter = string;

export type WriteOutcome = {
  slots: Record<string, string> | null;
  email: string | null;
  firstPass: boolean;
  finalPass: boolean;
  failed: string[];
  factsUsed: string[];
  ms: number;
  error?: string;
};

export type JudgeOutcome = { avg: number; claimsSupported: boolean; unsupported: string[] };
export type PairVerdict = "candidate" | "baseline" | "tie";

export type LeadRecord = {
  company: string | null;
  domain: string;
  setId: string;
  language: Language;
  facts: number;
  writes: Partial<Record<BakeoffWriter, WriteOutcome>>;
  judged: Partial<Record<BakeoffWriter, JudgeOutcome>>;
  /** Per candidate vs the baseline: the Opus verdict in each order, the combined verdict, Haiku's per order. */
  pairs: Partial<Record<BakeoffWriter, { opus: [PairVerdict, PairVerdict]; verdict: PairVerdict; haiku: [PairVerdict, PairVerdict] }>>;
};

export type ExtractorRow = { extractor: string; model: string; leads: number; facts: number; supported: number; unsupported: number; wrong: number; costUsd: number };
export type WriterRow = {
  writer: BakeoffWriter;
  model: string;
  emails: number;
  wins: number;
  losses: number;
  ties: number;
  judgeAvg: number | null;
  ruleFailRate: number | null;
  finalFailRate: number | null;
  claimsWithoutFactRate: number | null;
  costPerEmailUsd: number | null;
  avgMsPerEmail: number | null;
};
export type BlindPair = { n: number; company: string | null; a: string; b: string; key: { a: BakeoffWriter; b: BakeoffWriter } };

export type BakeoffReport = {
  provider: string;
  baseline: BakeoffWriter;
  judgeModel: string;
  agreementModel: string;
  leads: number;
  leadsWithFacts: number;
  firecrawlCredits: number;
  spentUsd: number;
  writers: WriterRow[];
  extraction: ExtractorRow[];
  judgeAgreement: { orders: number; agree: number; rate: number | null };
  bestCheaper: BakeoffWriter | null;
  blind: BlindPair[];
  /** Estimated real cost per email in production per writer (writer + Haiku extraction + Firecrawl), and pack margins. */
  production: { writer: BakeoffWriter; costPerEmailUsd: number; packs: { pack: string; pricePerCreditEur: number; marginPct: number }[] }[];
};

export type BakeoffStatus = "done" | "over_budget";
export type BakeoffProgress = { phase: string; done: number; total: number; spentUsd: number; projectedUsd: number | null; note?: string };

export type BakeoffDeps = {
  reader: WebReader;
  config: EngineConfig;
  /** An LLM whose steps use these models (overrides on the production config). */
  llmFor(models: Partial<StepModels>): LLM;
  /** Saves cost entries (usage_costs). Called for every paid call. */
  record(costs: CostEntry[]): Promise<void>;
  progress?(p: BakeoffProgress): Promise<void>;
  budgetUsd?: number;
  sleep?(ms: number): Promise<void>;
  batchPollMs?: number;
  random?: () => number;
  now?: () => number;
};

/** Model label as usage_costs shows it: Anthropic batches are "(batch)", DeepSeek's held-for-off-peak runs "(off-peak)". */
export const modelLabel = (sm: StepModel) => (sm.batch ? `${sm.model} (${providerOf(sm.model) === "deepseek" ? "off-peak" : "batch"})` : sm.model);

export class OverBudgetError extends Error {
  constructor(
    public spentUsd: number,
    public projectedUsd: number,
    public budgetUsd: number,
  ) {
    super(`The bake-off would cost about $${projectedUsd.toFixed(2)}, over the $${budgetUsd.toFixed(2)} budget (spent so far $${spentUsd.toFixed(2)}).`);
    this.name = "OverBudgetError";
  }
}

const judgeAverage = (j: JudgeScores) => (j.relevance + j.specificity + j.value_clarity + j.cta_effort + j.sounds_human + j.would_reply) / 6;
const round = (n: number, d = 4) => Math.round(n * 10 ** d) / 10 ** d;

/** Spend tracking with a hard stop: a call is only made when its expected cost still fits. */
class Budget {
  spent = 0;
  private avg = new Map<string, { n: number; usd: number }>();
  /** Total spent per key (e.g. "write:pro"): the writer's real cost, the same rows as usage_costs. */
  total(key: string): number {
    return this.avg.get(key)?.usd ?? 0;
  }
  constructor(
    readonly limit: number,
    private record: (c: CostEntry[]) => Promise<void>,
  ) {}
  expected(key: string): number {
    const a = this.avg.get(key);
    return a && a.n ? a.usd / a.n : 0;
  }
  /** Throws before the call when the expected cost (1.5x the average so far) wouldn't fit. */
  before(key: string) {
    const next = this.expected(key) * 1.5;
    if (this.spent + next > this.limit) throw new OverBudgetError(this.spent, this.spent + next, this.limit);
  }
  async charge(key: string, costs: CostEntry[]) {
    if (!costs.length) return;
    await this.record(costs);
    const usd = costs.reduce((s, c) => s + Number(c.cost_usd), 0);
    this.spent += usd;
    const a = this.avg.get(key) ?? { n: 0, usd: 0 };
    a.n += 1;
    a.usd += usd;
    this.avg.set(key, a);
  }
}

type SetCtx = { set: TestSet; language: Language; tpl: ReturnType<typeof parseTemplate>; rules: StyleRules };

function setContext(set: TestSet): SetCtx {
  const tpl = parseTemplate({ subject: set.template.subject, body: set.template.body });
  const rules = set.template.style_rules ?? {};
  const language = rules.language && rules.language !== "auto" ? rules.language : detectLanguage(set.template.body);
  return { set, language, tpl, rules };
}

function writeInput(sc: SetCtx, lead: TestLead, facts: Fact[], feedback?: string[], previous?: WriterOutput): WriteInput {
  return {
    writer: "pro",
    skillVersion: "1.0",
    language: sc.language,
    template: { subject: sc.set.template.subject, body: sc.set.template.body, slots: sc.tpl.slots },
    styleRules: sc.rules,
    facts,
    lead: { first_name: lead.first_name, company: lead.company, title: lead.title, linkedin_headline: null },
    examples: [],
    feedback,
    previous,
    personal: personalValues(lead),
  };
}

function checkOutput(sc: SetCtx, lead: TestLead, facts: Fact[], out: WriterOutput) {
  const ctx: CheckContext = { slots: sc.tpl.slots, facts, language: sc.language, skillVersion: out.skill_version, extraBanned: sc.rules.banned_phrases, company: lead.company };
  const checks = [...planCheck(out, ctx), ...ruleChecks(out, ctx)];
  const vars = { first_name: lead.first_name, company: lead.company, title: lead.title, domain: lead.domain, website: lead.website ?? lead.domain };
  const email = render(sc.tpl.body, vars, out.slots).replace(/\n{3,}/g, "\n\n").trim();
  return { pass: allPass(checks), failed: failureReasons(checks), email, factIdsOk: !checks.some((c) => c.id === "plan_facts_exist" && !c.pass) };
}

const slotLines = (w: WriteOutcome) => Object.entries(w.slots ?? {}).map(([k, v]) => `${k}: ${v}`).join("\n");
const toVerdict = (winner: "a" | "b" | "tie", candidateIsA: boolean): PairVerdict => (winner === "tie" ? "tie" : (winner === "a") === candidateIsA ? "candidate" : "baseline");

export async function runBakeoff(sets: TestSet[], deps: BakeoffDeps): Promise<{ status: BakeoffStatus; report: BakeoffReport; records: LeadRecord[]; projectedUsd: number | null }> {
  const setup = bakeoffSetup(deps.config.llmProvider);
  const WRITERS = Object.keys(setup.writers);
  const BASELINE = setup.baseline;
  const CANDIDATES = WRITERS.filter((w) => w !== BASELINE);
  const DIRECT = WRITERS.filter((w) => !setup.writers[w].batch);
  const BATCHED = WRITERS.filter((w) => setup.writers[w].batch);
  const budget = new Budget(deps.budgetUsd ?? BAKEOFF.budgetUsd, deps.record);
  const now = deps.now ?? (() => Date.now());
  const sleep = deps.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  const random = deps.random ?? Math.random;
  const ctxs = new Map(sets.map((s) => [s.id, setContext(s)]));
  const leads: BakeoffLead[] = sets.flatMap((s) => s.leads.map((l) => ({ ...l, setId: s.id }))).slice(0, BAKEOFF.maxLeads);
  const records: LeadRecord[] = [];
  const factsBy = new Map<number, Fact[]>();
  let credits = 0;
  let projectedUsd: number | null = null;
  const progress = (phase: string, done: number, total: number, note?: string) =>
    deps.progress?.({ phase, done, total, spentUsd: round(budget.spent), projectedUsd: projectedUsd == null ? null : round(projectedUsd, 2), note });

  const writerLLM = (w: BakeoffWriter) => deps.llmFor({ writer_pro: setup.writers[w], writer_economy: setup.writers[w] });
  const mainJudge = deps.llmFor({ judge: setup.judge, testset_judge: setup.judge });
  const agreementJudge = deps.llmFor({ testset_judge: setup.agreementJudge });
  const extractors = Object.fromEntries(Object.entries(setup.extractors).map(([k, sm]) => [k, deps.llmFor({ extraction: sm })]));
  const extraction: Record<string, ExtractorRow> = Object.fromEntries(
    Object.entries(setup.extractors).map(([k, sm]) => [k, { extractor: k, model: sm.model, leads: 0, facts: 0, supported: 0, unsupported: 0, wrong: 0, costUsd: 0 }]),
  );
  const writerMs = new Map<BakeoffWriter, number[]>();
  const tally = (w: BakeoffWriter, ms: number) => writerMs.set(w, [...(writerMs.get(w) ?? []), ms]);

  try {
    // 1. Facts for every lead (the production extractor), plus the extraction comparison on the first leads.
    for (let i = 0; i < leads.length; i++) {
      const lead = leads[i];
      const sc = ctxs.get(lead.setId)!;
      const rec: LeadRecord = { company: lead.company, domain: lead.domain, setId: lead.setId, language: sc.language, facts: 0, writes: {}, judged: {}, pairs: {} };
      records.push(rec);
      const r = await researchDomain(lead.domain, { reader: deps.reader, config: deps.config, website: lead.website ?? null });
      credits += r.costs.reduce((s, c) => s + Number(c.provider_units ?? 0), 0);
      await budget.charge("scrape", r.costs);
      if (r.status !== "ok" || !r.pages.length) {
        await progress("facts", i + 1, leads.length);
        continue;
      }
      const compare = i < BAKEOFF.extractionLeads;
      for (const [name, llm] of Object.entries(extractors)) {
        const production = setup.extractors[name].model === deps.config.models.extraction.model;
        if (!compare && !production) continue;
        budget.before(`extract:${name}`);
        const ex = await llm.extractFacts({ company: lead.company, domain: lead.domain, pages: r.pages, personal: personalValues(lead) });
        await budget.charge(`extract:${name}`, ex.costs);
        if (production) factsBy.set(i, ex.output.facts);
        if (!compare) continue;
        const row = extraction[name];
        row.leads += 1;
        row.facts += ex.output.facts.length;
        row.costUsd += ex.costs.reduce((s, c) => s + Number(c.cost_usd), 0);
        if (ex.output.facts.length && mainJudge.checkFacts) {
          budget.before("fact_check");
          const fc = await mainJudge.checkFacts({ domain: lead.domain, facts: ex.output.facts, pages: r.pages.map((p) => ({ url: p.url, markdown: p.markdown })) });
          await budget.charge("fact_check", fc.costs);
          for (const f of ex.output.facts) {
            const v = fc.output.checks.find((c) => c.id === f.id)?.verdict ?? "unsupported";
            row[v] += 1;
          }
        }
      }
      rec.facts = factsBy.get(i)?.length ?? 0;
      await progress("facts", i + 1, leads.length);
    }

    const withFacts = records.map((r, i) => i).filter((i) => (factsBy.get(i)?.length ?? 0) > 0);

    // 2. Direct writers, Opus scores and pairwise comparisons, lead by lead. After the pilot: project the whole run.
    const directPair = async (i: number, cand: BakeoffWriter) => {
      const rec = records[i];
      const c = rec.writes[cand];
      const b = rec.writes[BASELINE];
      if (!c?.email || !b?.email) return;
      const facts = factsBy.get(i)!;
      const lead = leads[i];
      const ask = async (llm: LLM, key: string, candidateIsA: boolean): Promise<PairVerdict> => {
        budget.before(key);
        const res = await llm.compare!({ language: rec.language, facts, role: lead.title, a: slotLines(candidateIsA ? c : b), b: slotLines(candidateIsA ? b : c) });
        await budget.charge(key, res.costs);
        return toVerdict(res.output.winner, candidateIsA);
      };
      const o1 = await ask(mainJudge, "compare:main", true);
      const o2 = await ask(mainJudge, "compare:main", false);
      const h1 = await ask(agreementJudge, "compare:agreement", true);
      const h2 = await ask(agreementJudge, "compare:agreement", false);
      rec.pairs[cand] = { opus: [o1, o2], verdict: o1 === o2 ? o1 : "tie", haiku: [h1, h2] };
    };
    const score = async (i: number, w: BakeoffWriter) => {
      const out = records[i].writes[w];
      if (!out?.email || !out.slots) return;
      budget.before("judge:main");
      const j = await mainJudge.judge({ language: records[i].language, slots: out.slots, facts: factsBy.get(i)!, emailPreview: out.email, role: leads[i].title, personal: personalValues(leads[i]) });
      await budget.charge("judge:main", j.costs);
      records[i].judged[w] = { avg: round(judgeAverage(j.output), 2), claimsSupported: j.output.claims_supported, unsupported: j.output.unsupported_claims };
    };
    const writeDirect = async (i: number, w: BakeoffWriter) => {
      const lead = leads[i];
      const sc = ctxs.get(lead.setId)!;
      const facts = factsBy.get(i)!;
      const llm = writerLLM(w);
      const started = now();
      let firstPass = false;
      let last: { out: WriterOutput; c: ReturnType<typeof checkOutput> } | null = null;
      try {
        for (let attempt = 1; attempt <= 2; attempt++) {
          budget.before(`write:${w}`);
          const res = await llm.write(writeInput(sc, lead, facts, last ? last.c.failed : undefined, last?.out));
          await budget.charge(`write:${w}`, res.costs);
          const c = checkOutput(sc, lead, facts, res.output);
          if (attempt === 1) firstPass = c.pass;
          last = { out: res.output, c };
          if (c.pass) break;
        }
      } catch (e) {
        if (!(e instanceof LLMRefusalError)) throw e;
        records[i].writes[w] = { slots: null, email: null, firstPass: false, finalPass: false, failed: [], factsUsed: [], ms: now() - started, error: "The model declined" };
        return;
      }
      const ms = now() - started;
      tally(w, ms);
      records[i].writes[w] = { slots: last!.out.slots, email: last!.c.email, firstPass, finalPass: last!.c.pass, failed: last!.c.failed, factsUsed: last!.out.facts_used, ms };
    };

    const pilot = Math.min(BAKEOFF.pilotLeads, withFacts.length);
    let batchId: string | null = null;
    let batchStarted = 0;
    const submitBatch = async (round1: number[], feedback?: Map<number, { failed: string[]; out: WriterOutput }>) => {
      const w = BATCHED[0];
      const llm = writerLLM(w);
      if (!llm.batch || !round1.length) return null;
      const items = round1.map((i) => {
        const fb = feedback?.get(i);
        return { id: `L${i}`, input: writeInput(ctxs.get(leads[i].setId)!, leads[i], factsBy.get(i)!, fb?.failed, fb?.out) };
      });
      return llm.batch.submit(items);
    };

    for (let n = 0; n < withFacts.length; n++) {
      const i = withFacts[n];
      for (const w of DIRECT) await writeDirect(i, w);
      for (const w of DIRECT) await score(i, w);
      for (const c of CANDIDATES.filter((x) => DIRECT.includes(x))) await directPair(i, c);
      await progress("writers", n + 1, withFacts.length);
      if (n + 1 === pilot) {
        // Projection: the rest of the direct leads, plus the batch writer for every lead (half the Sonnet price).
        const perLead = (key: string, times: number) => budget.expected(key) * times;
        const directPerLead =
          DIRECT.reduce((s, w) => s + perLead(`write:${w}`, 1.3), 0) + perLead("judge:main", DIRECT.length) + perLead("compare:main", 2 * (DIRECT.length - 1)) + perLead("compare:agreement", 2 * (DIRECT.length - 1));
        const batchPerLead = BATCHED.length ? perLead(`write:${BASELINE}`, 1.3) * 0.5 + perLead("judge:main", 1) + perLead("compare:main", 2) + perLead("compare:agreement", 2) : 0;
        projectedUsd = budget.spent + directPerLead * (withFacts.length - pilot) + batchPerLead * withFacts.length;
        await progress("writers", n + 1, withFacts.length, "projected");
        if (projectedUsd > budget.limit) throw new OverBudgetError(budget.spent, projectedUsd, budget.limit);
        batchId = await submitBatch(withFacts);
        batchStarted = now();
      }
    }
    if (pilot === 0 || withFacts.length < pilot) {
      batchId = batchId ?? (await submitBatch(withFacts));
      batchStarted = batchStarted || now();
    }

    // 3. The batch writer: wait, check, one rewrite round through a second batch, then score and compare.
    if (batchId && BATCHED.length) {
      const w = BATCHED[0];
      const llm = writerLLM(w);
      const collect = async (id: string, ids: number[]) => {
        while ((await llm.batch!.status(id)) !== "ended") {
          await progress("batch", 0, ids.length, "waiting for the batch (usually under an hour, at most 24 h)");
          await sleep(deps.batchPollMs ?? 60_000);
        }
        const items = ids.map((i) => ({ id: `L${i}`, input: writeInput(ctxs.get(leads[i].setId)!, leads[i], factsBy.get(i)!) }));
        return llm.batch!.results(id, items);
      };
      const first = await collect(batchId, withFacts);
      const retry = new Map<number, { failed: string[]; out: WriterOutput }>();
      for (const r of first) {
        const i = Number(r.id.slice(1));
        await budget.charge(`write:${w}`, r.costs);
        if (!r.output) {
          records[i].writes[w] = { slots: null, email: null, firstPass: false, finalPass: false, failed: [], factsUsed: [], ms: 0, error: r.error };
          continue;
        }
        const c = checkOutput(ctxs.get(leads[i].setId)!, leads[i], factsBy.get(i)!, r.output);
        records[i].writes[w] = { slots: r.output.slots, email: c.email, firstPass: c.pass, finalPass: c.pass, failed: c.failed, factsUsed: r.output.facts_used, ms: 0 };
        if (!c.pass) retry.set(i, { failed: c.failed, out: r.output });
      }
      if (retry.size) {
        const id2 = await submitBatch([...retry.keys()], retry);
        if (id2) {
          for (const r of await collect(id2, [...retry.keys()])) {
            const i = Number(r.id.slice(1));
            await budget.charge(`write:${w}`, r.costs);
            if (!r.output) continue;
            const c = checkOutput(ctxs.get(leads[i].setId)!, leads[i], factsBy.get(i)!, r.output);
            records[i].writes[w] = { ...records[i].writes[w]!, slots: r.output.slots, email: c.email, finalPass: c.pass, failed: c.failed, factsUsed: r.output.facts_used };
          }
        }
      }
      // Wall time per email: the whole batch wait shared over its emails (Economy delivers within hours, not seconds).
      const perEmail = withFacts.length ? (now() - batchStarted) / withFacts.length : 0;
      for (const i of withFacts) {
        const out = records[i].writes[w];
        if (!out) continue;
        out.ms = perEmail;
        tally(w, perEmail);
      }
      for (let n = 0; n < withFacts.length; n++) {
        await score(withFacts[n], w);
        await directPair(withFacts[n], w);
        await progress("batch writer", n + 1, withFacts.length);
      }
    }
  } catch (e) {
    if (!(e instanceof OverBudgetError)) throw e;
    projectedUsd = e.projectedUsd;
    return { status: "over_budget", report: buildReport(setup, deps.config.llmProvider, records, leads.length, credits, budget, extraction, writerMs, random), records, projectedUsd };
  }
  return { status: "done", report: buildReport(setup, deps.config.llmProvider, records, leads.length, credits, budget, extraction, writerMs, random), records, projectedUsd };
}

function buildReport(
  setup: BakeoffSetup,
  provider: string,
  records: LeadRecord[],
  leads: number,
  credits: number,
  budget: Budget,
  extraction: Record<string, ExtractorRow>,
  writerMs: Map<BakeoffWriter, number[]>,
  random: () => number,
): BakeoffReport {
  const WRITERS = Object.keys(setup.writers);
  const BASELINE = setup.baseline;
  const spent = budget.spent;
  const avg = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null);
  const rate = (hit: number, n: number) => (n ? round(hit / n, 3) : null);
  const writers: WriterRow[] = WRITERS.map((w) => {
    const outs = records.map((r) => r.writes[w]).filter((x): x is WriteOutcome => !!x);
    const emails = outs.filter((o) => o.email);
    const pairs = records.map((r) => r.pairs[w]).filter((p) => !!p);
    const judged = records.map((r) => r.judged[w]).filter((j): j is JudgeOutcome => !!j);
    const noFact = records.filter((r) => r.writes[w]?.email && (!r.writes[w]!.factsUsed.length || r.judged[w]?.claimsSupported === false)).length;
    return {
      writer: w,
      model: modelLabel(setup.writers[w]),
      emails: emails.length,
      wins: pairs.filter((p) => p!.verdict === "candidate").length,
      losses: pairs.filter((p) => p!.verdict === "baseline").length,
      ties: pairs.filter((p) => p!.verdict === "tie").length,
      judgeAvg: avg(judged.map((j) => j.avg)) == null ? null : round(avg(judged.map((j) => j.avg))!, 2),
      ruleFailRate: rate(outs.filter((o) => !o.error && !o.firstPass).length, outs.filter((o) => !o.error).length),
      finalFailRate: rate(outs.filter((o) => !o.error && !o.finalPass).length, outs.filter((o) => !o.error).length),
      claimsWithoutFactRate: rate(noFact, emails.length),
      // Every write call of this writer, rewrites included (the same rows as in usage_costs).
      costPerEmailUsd: emails.length ? round(budget.total(`write:${w}`) / emails.length, 6) : null,
      avgMsPerEmail: avg(writerMs.get(w) ?? []) == null ? null : Math.round(avg(writerMs.get(w) ?? [])!),
    };
  });
  let orders = 0;
  let agree = 0;
  for (const r of records)
    for (const p of Object.values(r.pairs)) {
      if (!p) continue;
      orders += 2;
      agree += (p.opus[0] === p.haiku[0] ? 1 : 0) + (p.opus[1] === p.haiku[1] ? 1 : 0);
    }
  const share = (w: BakeoffWriter) => {
    const row = writers.find((x) => x.writer === w)!;
    const n = row.wins + row.losses + row.ties;
    return n ? (row.wins + row.ties / 2) / n : -1;
  };
  const cheaper = setup.cheaper.filter((w) => w in setup.writers);
  const bestCheaper = cheaper.length ? cheaper.reduce((a, b) => (share(b) > share(a) ? b : a)) : null;
  const blind: BlindPair[] = [];
  if (bestCheaper) {
    const pool = records.filter((r) => r.writes[bestCheaper]?.email && r.writes[BASELINE]?.email);
    for (let k = pool.length - 1; k > 0; k--) {
      const j = Math.floor(random() * (k + 1));
      [pool[k], pool[j]] = [pool[j], pool[k]];
    }
    pool.slice(0, BAKEOFF.blindPairs).forEach((r, n) => {
      const swap = random() < 0.5;
      const a = swap ? BASELINE : bestCheaper;
      const b = swap ? bestCheaper : BASELINE;
      blind.push({ n: n + 1, company: r.company, a: r.writes[a]!.email!, b: r.writes[b]!.email!, key: { a, b } });
    });
  }
  const ex = Object.values(extraction).map((r) => ({ ...r, costUsd: round(r.costUsd, 6) }));
  return {
    provider,
    baseline: BASELINE,
    judgeModel: setup.judge.model,
    agreementModel: setup.agreementJudge.model,
    leads,
    leadsWithFacts: records.filter((r) => r.facts > 0).length,
    firecrawlCredits: credits,
    spentUsd: round(spent, 4),
    writers,
    extraction: ex,
    judgeAgreement: { orders, agree, rate: rate(agree, orders) },
    bestCheaper,
    blind,
    production: [],
  };
}

/**
 * The production estimate per writer: writer + extraction per lead (the production extractor) + Firecrawl
 * credits per lead, against each pack on sale's price per credit.
 */
export function finishReport(report: BakeoffReport, config: EngineConfig, env: Record<string, string | undefined> = process.env): BakeoffReport {
  const extractRow = report.extraction.find((r) => r.model === config.models.extraction.model);
  const extractPerLead = extractRow && extractRow.leads ? extractRow.costUsd / extractRow.leads : 0;
  const firecrawlPerLead = report.leads ? (report.firecrawlCredits / report.leads) * config.firecrawlUsdPerCredit : 0;
  const production = report.writers
    .filter((w) => w.costPerEmailUsd != null)
    .map((w) => {
      const costPerEmailUsd = round(w.costPerEmailUsd! + extractPerLead + firecrawlPerLead, 6);
      const costEur = usdToEur(costPerEmailUsd, env);
      const packs = enabledPacks(env)
        .filter((p) => p.kind === "standard")
        .map((p) => {
          const price = p.priceCents / 100 / p.credits;
          return { pack: p.id, pricePerCreditEur: round(price, 4), marginPct: round(((price - costEur) / price) * 100, 1) };
        });
      return { writer: w.writer, costPerEmailUsd, packs };
    });
  return { ...report, production };
}

/** Before a run: what it will roughly use (shown on the Start button). */
export function bakeoffPlan(sets: TestSet[], config: EngineConfig) {
  const setup = bakeoffSetup(config.llmProvider);
  const leads = Math.min(BAKEOFF.maxLeads, sets.reduce((s, x) => s + x.leads.length, 0));
  return {
    leads,
    extractionLeads: Math.min(BAKEOFF.extractionLeads, leads),
    blindPairs: BAKEOFF.blindPairs,
    budgetUsd: BAKEOFF.budgetUsd,
    /** map + pages per lead. */
    firecrawlCredits: leads * (1 + config.research.maxPages),
    writers: Object.entries(setup.writers).map(([w, sm]) => ({ writer: w, model: modelLabel(sm) })),
    judge: setup.judge.model,
    agreementJudge: setup.agreementJudge.model,
    extractors: Object.values(setup.extractors).map((sm) => sm.model),
  };
}
