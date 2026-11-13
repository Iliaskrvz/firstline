// Model bake-off with scripted models: no network, recorded-style token usage, deterministic verdicts.
import { describe, expect, it } from "vitest";
import { BAKEOFF, STEP_MODELS } from "@/config/models";
import { bakeoffPlan, finishReport, runBakeoff, type BakeoffDeps } from "./bakeoff";
import { EN, NL, reader, scripted } from "./bakeoff.fixtures";
import { engineConfig } from "./config";
import type { CostEntry } from "./types";

function deps(budgetUsd?: number) {
  const recorded: CostEntry[] = [];
  let t = 0;
  const d: BakeoffDeps = {
    reader,
    config: engineConfig({}),
    llmFor: (m) => scripted({ ...STEP_MODELS, ...m }),
    record: async (c) => void recorded.push(...c),
    budgetUsd,
    sleep: async () => {},
    random: () => 0.3,
    now: () => (t += 1000),
  };
  return { d, recorded };
}

describe("model bake-off", () => {
  it("runs every writer on the same facts, compares blind in both orders, and reports cost vs quality", async () => {
    const { d, recorded } = deps();
    const out = await runBakeoff([EN, NL], d);
    expect(out.status).toBe("done");
    const r = out.report;
    expect(r.leads).toBe(7);
    expect(r.leadsWithFacts).toBe(7);
    expect(r.firecrawlCredits).toBe(7 * 3); // map + 2 pages per site

    const row = (w: string) => r.writers.find((x) => x.writer === w)!;
    expect(row("sonnet")).toMatchObject({ emails: 7, wins: 0, losses: 0, ties: 0, ruleFailRate: 0 });
    expect(row("haiku")).toMatchObject({ emails: 7, wins: 0, losses: 7, ties: 0, judgeAvg: 3 });
    expect(row("opus")).toMatchObject({ emails: 7, wins: 7, losses: 0, judgeAvg: 5 });
    expect(row("sonnet_batch")).toMatchObject({ model: "claude-sonnet-5-5 (batch)", emails: 7, ties: 7, judgeAvg: 4 });
    expect(row("haiku").claimsWithoutFactRate).toBe(0);
    expect(row("opus").avgMsPerEmail).toBeGreaterThan(0);

    // Haiku always says "A": with Haiku and Opus it agrees in one of the two orders; on the batch (a tie for Opus) in none.
    expect(r.judgeAgreement).toEqual({ orders: 3 * 7 * 2, agree: 2 * 7, rate: 0.333 });

    // Extraction: the extra Sonnet fact isn't on the page.
    const ex = Object.fromEntries(r.extraction.map((e) => [e.extractor, e]));
    expect(ex.haiku.leads).toBe(7);
    expect(ex.sonnet.facts).toBe(ex.haiku.facts + 7);
    expect(ex.sonnet.unsupported).toBeGreaterThanOrEqual(7);
    expect(ex.haiku.costUsd).toBeLessThan(ex.sonnet.costUsd);

    // Blind sheet: the best cheaper option (the batch ties, Haiku loses) vs Sonnet, without model names.
    expect(r.bestCheaper).toBe("sonnet_batch");
    expect(r.blind).toHaveLength(7);
    expect(r.blind.every((p) => new Set([p.key.a, p.key.b]).size === 2 && [p.key.a, p.key.b].includes("sonnet"))).toBe(true);
    expect(JSON.stringify(r.blind.map(({ a, b, company }) => ({ a, b, company })))).not.toMatch(/claude|sonnet|haiku|opus/i);

    // Every paid call went to usage_costs; the report's cost per email comes from those rows.
    const byLabel = recorded.filter((c) => c.step === "write").map((c) => ({ step: c.step, model: c.model!, usd: c.cost_usd }));
    const final = finishReport(r, byLabel, d.config, {});
    expect(final.writers.find((w) => w.writer === "sonnet")!.costPerEmailUsd).toBe(0.01); // 2000 in + 600 out on Sonnet
    expect(final.writers.find((w) => w.writer === "sonnet_batch")!.costPerEmailUsd).toBe(0.005);
    expect(final.writers.find((w) => w.writer === "haiku")!.costPerEmailUsd).toBe(0.0005);
    const prod = final.production.find((p) => p.writer === "sonnet")!;
    expect(prod.packs.map((p) => p.pack)).toEqual(["starter", "growth", "agency"]);
    expect(prod.packs[0].marginPct).toBeGreaterThan(0);
    expect(recorded.some((c) => c.step === "fact_check" && c.model === "claude-opus-5-5")).toBe(true);
    expect(recorded.some((c) => c.step === "compare" && c.model === "claude-haiku-5-5")).toBe(true);
  });

  it("stops before going over the budget, after the pilot projection", async () => {
    const { d, recorded } = deps(0.12);
    const out = await runBakeoff([EN, NL], d);
    expect(out.status).toBe("over_budget");
    expect(out.projectedUsd!).toBeGreaterThan(0.12);
    const spent = recorded.reduce((s, c) => s + c.cost_usd, 0);
    expect(spent).toBeLessThanOrEqual(0.12);
    expect(recorded.some((c) => c.model === "claude-sonnet-5-5 (batch)")).toBe(false); // the batch never started
  });

  it("the plan shows leads, Firecrawl credits and the budget before anything runs", () => {
    const p = bakeoffPlan([EN, NL], engineConfig({}));
    expect(p).toMatchObject({ leads: 7, extractionLeads: 7, budgetUsd: BAKEOFF.budgetUsd, firecrawlCredits: 7 * 5 });
    expect(p.writers.map((w) => w.model)).toEqual(["claude-sonnet-5-5", "claude-haiku-5-5", "claude-sonnet-5-5 (batch)", "claude-opus-5-5"]);
  });
});
