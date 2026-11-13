// Model bake-off with scripted models: no network, fixed request times (DeepSeek's price depends on the
// hour), deterministic verdicts.
import { describe, expect, it } from "vitest";
import { BAKEOFF } from "@/config/models";
import { bakeoffPlan, finishReport, runBakeoff, type BakeoffDeps } from "./bakeoff";
import { EN, NL, reader, scripted } from "./bakeoff.fixtures";
import { engineConfig } from "./config";
import type { CostEntry } from "./types";

function deps(env: Record<string, string> = { LLM_PROVIDER: "deepseek" }, budgetUsd?: number) {
  const recorded: CostEntry[] = [];
  let t = 0;
  const config = engineConfig(env);
  const d: BakeoffDeps = {
    reader,
    config,
    llmFor: (m) => scripted({ ...config.models, ...m }),
    record: async (c) => void recorded.push(...c),
    budgetUsd,
    sleep: async () => {},
    random: () => 0.3,
    now: () => (t += 1000),
  };
  return { d, recorded };
}

describe("model bake-off (DeepSeek)", () => {
  it("V4 Pro vs Flash vs V4 Pro off-peak on the same facts, compared blind in both orders, with cost per email", async () => {
    const { d, recorded } = deps();
    const out = await runBakeoff([EN, NL], d);
    expect(out.status).toBe("done");
    const r = out.report;
    expect(r).toMatchObject({ provider: "deepseek", baseline: "pro", judgeModel: "deepseek-v4-pro", agreementModel: "deepseek-flash", leads: 7, leadsWithFacts: 7 });
    expect(r.firecrawlCredits).toBe(7 * 3); // map + 2 pages per site

    const row = (w: string) => r.writers.find((x) => x.writer === w)!;
    expect(row("pro")).toMatchObject({ model: "deepseek-v4-pro", emails: 7, wins: 0, losses: 0, ties: 0, ruleFailRate: 0, judgeAvg: 4 });
    expect(row("flash")).toMatchObject({ model: "deepseek-flash", emails: 7, losses: 7, judgeAvg: 3 });
    expect(row("pro_offpeak")).toMatchObject({ model: "deepseek-v4-pro (off-peak)", emails: 7, ties: 7, judgeAvg: 4 });
    // Real cost per email at the request's hour: 2,000 cache-miss tokens in, 600 out.
    expect(row("pro").costPerEmailUsd).toBe(0.005016); // peak: $1.32 / $3.96 per million
    expect(row("pro_offpeak").costPerEmailUsd).toBe(0.002508); // off-peak: half
    expect(row("flash").costPerEmailUsd).toBe(0.00132); // peak: $0.30 / $1.20

    // Flash always says "A": it agrees with V4 Pro in one order on the Flash pairs, never on the (tied) off-peak pairs.
    expect(r.judgeAgreement).toEqual({ orders: 2 * 7 * 2, agree: 7, rate: 0.25 });

    const ex = Object.fromEntries(r.extraction.map((e) => [e.extractor, e]));
    expect(ex.flash.leads).toBe(7);
    expect(ex.pro.facts).toBe(ex.flash.facts + 7);
    expect(ex.pro.unsupported).toBeGreaterThanOrEqual(7);
    expect(ex.flash.costUsd).toBeLessThan(ex.pro.costUsd);

    expect(r.bestCheaper).toBe("pro_offpeak");
    expect(r.blind).toHaveLength(7);
    expect(r.blind.every((p) => [p.key.a, p.key.b].includes("pro") && p.key.a !== p.key.b)).toBe(true);
    expect(JSON.stringify(r.blind.map(({ a, b, company }) => ({ a, b, company })))).not.toMatch(/deepseek|flash|v4|claude/i);

    const final = finishReport(r, d.config, {});
    expect(final.production.find((p) => p.writer === "flash")!.packs.map((p) => p.pack)).toEqual(["starter", "growth", "agency"]);
    expect(recorded.some((c) => c.step === "fact_check" && c.model === "deepseek-v4-pro")).toBe(true);
    expect(recorded.some((c) => c.step === "compare" && c.model === "deepseek-flash")).toBe(true);
    expect(recorded.some((c) => c.model === "deepseek-v4-pro (off-peak)")).toBe(true);
  });

  it("stops before going over the budget", async () => {
    const { d, recorded } = deps({ LLM_PROVIDER: "deepseek" }, 0.06);
    const out = await runBakeoff([EN, NL], d);
    expect(out.status).toBe("over_budget");
    expect(out.projectedUsd!).toBeGreaterThan(0.06);
    expect(recorded.reduce((s, c) => s + c.cost_usd, 0)).toBeLessThanOrEqual(0.06 + 0.01); // at most one call past it
    expect(recorded.some((c) => c.model === "deepseek-v4-pro (off-peak)")).toBe(false);
  });

  it("the plan shows the DeepSeek candidates, Firecrawl credits and the budget before anything runs", () => {
    const p = bakeoffPlan([EN, NL], engineConfig({ LLM_PROVIDER: "deepseek" }));
    expect(p).toMatchObject({ leads: 7, extractionLeads: 7, budgetUsd: BAKEOFF.budgetUsd, firecrawlCredits: 7 * 5, judge: "deepseek-v4-pro", agreementJudge: "deepseek-flash" });
    expect(p.writers.map((w) => w.model)).toEqual(["deepseek-v4-pro", "deepseek-flash", "deepseek-v4-pro (off-peak)"]);
    expect(p.extractors).toEqual(["deepseek-flash", "deepseek-v4-pro"]);
  });
});

describe("model bake-off (Claude, kept for switching back)", () => {
  it("uses the Claude setup when LLM_PROVIDER=anthropic", async () => {
    const { d } = deps({ LLM_PROVIDER: "anthropic" });
    const r = (await runBakeoff([EN], d)).report;
    expect(r).toMatchObject({ provider: "anthropic", baseline: "sonnet", judgeModel: "claude-opus-5-5", agreementModel: "claude-haiku-5-5" });
    expect(r.writers.find((w) => w.writer === "sonnet")!.costPerEmailUsd).toBe(0.01);
    expect(r.writers.find((w) => w.writer === "sonnet_batch")!).toMatchObject({ model: "claude-sonnet-5-5 (batch)", costPerEmailUsd: 0.005 });
    expect(r.writers.find((w) => w.writer === "opus")!.wins).toBe(4);
  });
});
