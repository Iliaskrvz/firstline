// Model bake-off on a real Postgres 17 (embedded) with scripted models: the run is stored, every cost
// lands in usage_costs without a workspace (members can't see it, margins leave it out), and the
// owner's blind picks are tallied only when complete.
import EmbeddedPostgres from "embedded-postgres";
import { mkdtempSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { loadAdmin, loadCostBreakdown } from "@/billing/admin-db";
import { EN, NL, reader, scripted } from "@/engine/bakeoff.fixtures";
import { blindTally, getBakeoff, listBakeoffs, queueBakeoff, runQueuedBakeoff, saveBlindPick } from "@/engine/bakeoff-pg";
import { engineConfig } from "@/engine/config";
import { saveTestSet } from "@/engine/lab-pg";

const root = path.resolve(__dirname, "..");
let server: EmbeddedPostgres;
let pool: pg.Pool;
let dir: string;

beforeAll(async () => {
  dir = mkdtempSync(path.join(tmpdir(), "firstline-bakeoff-"));
  const port = 61_000 + Math.floor(Math.random() * 2_000);
  server = new EmbeddedPostgres({ databaseDir: dir, user: "postgres", password: "test", port, persistent: false, onLog: () => {} });
  await server.initialise();
  await server.start();
  pool = new pg.Pool({ host: "127.0.0.1", port, user: "postgres", password: "test", database: "postgres", max: 5 });
  await pool.query(readFileSync(path.join(root, "tests/supabase-shim.sql"), "utf8"));
  for (const f of readdirSync(path.join(root, "migrations")).filter((f) => f.endsWith(".sql")).sort()) {
    await pool.query(readFileSync(path.join(root, "migrations", f), "utf8"));
  }
  await saveTestSet(pool, EN);
  await saveTestSet(pool, NL);
}, 120_000);

afterAll(async () => {
  await pool?.end();
  await server?.stop();
  rmSync(dir, { recursive: true, force: true });
});

const config = engineConfig({ LLM_PROVIDER: "deepseek" });
const deps = () => ({ reader, config, llmFor: (m: object) => scripted({ ...config.models, ...m }), sleep: async () => {}, random: () => 0.3 });

describe("model bake-off (database)", () => {
  let id: number;

  it("runs a queued bake-off and stores the report; costs go to usage_costs without a workspace", async () => {
    id = await queueBakeoff(pool, { testSetIds: ["nl", "en"], provider: "deepseek", approvedBy: "owner@firstline.test" });
    expect(await runQueuedBakeoff(pool, deps())).toBe(id);
    expect(await runQueuedBakeoff(pool, deps())).toBeNull();

    const run = (await getBakeoff(pool, id))!;
    expect(run.status).toBe("done");
    expect(run.report!.leads).toBe(7);
    const pro = run.report!.writers.find((w) => w.writer === "pro")!;
    expect(pro.costPerEmailUsd).toBe(0.005016);
    const prod = (w: string) => run.report!.production.find((p) => p.writer === w)!.costPerEmailUsd;
    expect(prod("flash")).toBeLessThan(prod("pro")); // writer + extraction + Firecrawl per lead

    const { rows } = await pool.query("select count(*)::int n, count(workspace_id)::int with_ws, sum(cost_usd)::float usd from public.usage_costs where bakeoff_run_id = $1", [id]);
    expect(rows[0].n).toBeGreaterThan(40);
    expect(rows[0].with_ws).toBe(0);
    expect(Number(run.cost_usd)).toBeCloseTo(rows[0].usd, 5);
    expect((await listBakeoffs(pool))[0]).toMatchObject({ id, status: "done", report: null });
  });

  it("/admin shows the lab spend per step and model, and keeps it out of the customer margins", async () => {
    const breakdown = await loadCostBreakdown(pool);
    expect(breakdown.every((r) => r.source === "lab")).toBe(true);
    expect(breakdown.some((r) => r.step === "compare" && r.model === "deepseek-v4-pro")).toBe(true);
    expect(breakdown.some((r) => r.step === "write" && r.model === "deepseek-v4-pro (off-peak)")).toBe(true);
    expect(breakdown.reduce((s, r) => s + r.share, 0)).toBeCloseTo(1, 5);
    const admin = await loadAdmin(pool);
    expect(admin.days.reduce((s, d) => s + d.costUsd, 0)).toBe(0);
  });

  it("blind picks are revealed only when every pair is picked", async () => {
    const run = (await getBakeoff(pool, id))!;
    const pairs = run.report!.blind;
    expect(pairs.length).toBe(7);
    await saveBlindPick(pool, id, 1, "a");
    expect(blindTally(run.report!, (await getBakeoff(pool, id))!.picks)).toMatchObject({ done: 1, complete: false, count: null });
    for (const p of pairs.slice(1)) await saveBlindPick(pool, id, p.n, p.n % 2 ? "same" : "b");
    const t = blindTally(run.report!, (await getBakeoff(pool, id))!.picks);
    expect(t.complete).toBe(true);
    expect(Object.values(t.count!).reduce((a, b) => a + b, 0)).toBe(7);
  });

  it("over the budget: stopped with partial results, nothing written past it", async () => {
    const small = await queueBakeoff(pool, { testSetIds: ["en"], provider: "deepseek", approvedBy: "owner@firstline.test" });
    await pool.query("update public.bakeoff_runs set budget_usd = 0.03 where id = $1", [small]);
    await runQueuedBakeoff(pool, deps());
    const run = (await getBakeoff(pool, small))!;
    expect(run.status).toBe("over_budget");
    expect(Number(run.cost_usd)).toBeLessThanOrEqual(0.04);
  });
});
