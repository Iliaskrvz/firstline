// Integration: Economy mode on a real Postgres 17 (embedded). Defer → batch → collect → finish,
// with credits and costs, and a stopped campaign giving its credits back.
import EmbeddedPostgres from "embedded-postgres";
import { mkdtempSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { addPurchase, balance, reserveForRun, stopRun } from "@/billing/db";
import { engineConfig } from "@/engine/config";
import { collectFinished, submitPending } from "@/engine/economy-pg";
import type { WebReader } from "@/engine/firecrawl";
import type { BatchWriter, LLM } from "@/engine/llm";
import { FakeLLM } from "@/engine/llm-fake";
import { processLead } from "@/engine/pipeline";
import { PgStore } from "@/engine/store-pg";

const root = path.resolve(__dirname, "..");
const USER = "00000000-0000-0000-0000-0000000000cc";
let server: EmbeddedPostgres;
let pool: pg.Pool;
let dir: string;
let ws: string;
let template: string;

const reader: WebReader = {
  robots: async () => null,
  map: async () => ({ links: [{ url: "https://bakkerij.nl/over-ons" }], credits: 1 }),
  scrape: async () => ({
    markdown:
      "# Over ons\n\nBakkerij Bos bakt sinds 1987 elke ochtend vers brood in Utrecht en levert aan veertig restaurants in de regio. Dit jaar openden ze een tweede winkel in Amersfoort.",
    statusCode: 200,
    credits: 1,
  }),
};

/** A batch that ends when the test says so, answers at the batch price, and can drop or fail items. */
function testLLM(opts: { failIds?: () => string[] } = {}) {
  const fake = new FakeLLM();
  const state = { ended: false, submitted: [] as string[][] };
  const batch: BatchWriter = {
    submit: async (items) => (state.submitted.push(items.map((i) => i.id)), `test-batch-${state.submitted.length}`),
    status: async () => (state.ended ? "ended" : "in_progress"),
    results: async (_id, items) =>
      Promise.all(
        items.map(async (it) =>
          opts.failIds?.().includes(it.id)
            ? { id: it.id, costs: [], error: "Batch request expired" }
            : { id: it.id, output: (await fake.write(it.input)).output, costs: [{ step: "write" as const, model: "claude-sonnet-5-5 (batch)", cost_usd: 0.004 }] },
        ),
      ),
  };
  const llm: LLM = { provider: "fake", extractorId: fake.extractorId, extractFacts: (i) => fake.extractFacts(i), write: (i) => fake.write(i), judge: () => fake.judge(), batch };
  return { llm, state };
}

async function campaign(name: string, n: number) {
  const id = (await pool.query("insert into public.campaigns (workspace_id, name, template_id, status, mode) values ($1, $2, $3, 'running', 'economy') returning id", [ws, name, template]))
    .rows[0].id as string;
  const leads: string[] = [];
  for (let i = 0; i < n; i++) {
    leads.push(
      (
        await pool.query(
          "insert into public.leads (workspace_id, campaign_id, email, first_name, company, domain, created_at) values ($1, $2, $3, 'X', 'Bos', 'bakkerij.nl', clock_timestamp()) returning id",
          [ws, id, `${name}-${i}@bos.nl`],
        )
      ).rows[0].id,
    );
  }
  await reserveForRun(pool, { workspaceId: ws, leadIds: leads, perLead: 1 });
  return { id, leads };
}

beforeAll(async () => {
  dir = mkdtempSync(path.join(tmpdir(), "firstline-eco-"));
  const port = 44_000 + Math.floor(Math.random() * 4_000);
  server = new EmbeddedPostgres({ databaseDir: dir, user: "postgres", password: "test", port, persistent: false, onLog: () => {} });
  await server.initialise();
  await server.start();
  pool = new pg.Pool({ host: "127.0.0.1", port, user: "postgres", password: "test", database: "postgres", max: 10 });
  await pool.query(readFileSync(path.join(root, "tests/supabase-shim.sql"), "utf8"));
  for (const f of readdirSync(path.join(root, "migrations")).filter((f) => f.endsWith(".sql")).sort()) {
    await pool.query(readFileSync(path.join(root, "migrations", f), "utf8"));
  }
  await pool.query("insert into auth.users (id, email) values ($1, 'owner@eco.nl')", [USER]);
  ws = (await pool.query("select id from public.workspaces where owner_id = $1", [USER])).rows[0].id;
  template = (
    await pool.query(
      `insert into public.templates (workspace_id, name, subject, body) values ($1, 'T', 'Idee voor {{company}}',
       'Hoi {{first_name}},\n\n[[opener · iets specifieks van hun website · 25]]\n\nGroet') returning id`,
      [ws],
    )
  ).rows[0].id;
  await addPurchase(pool, { workspaceId: ws, credits: 20, key: "test:eco", note: "test" });
}, 120_000);

afterAll(async () => {
  await pool?.end();
  await server?.stop();
  rmSync(dir, { recursive: true, force: true });
});

describe("Economy mode", () => {
  it("defers every lead, sends one batch per campaign, then finishes the leads at the batch price", async () => {
    const { llm, state } = testLLM();
    const deps = { store: new PgStore(pool), reader, llm, config: engineConfig({}) };
    const c = await campaign("eco", 3);
    const queued: string[][] = [];
    const enqueue = async (leads: { leadId: string }[], runId: string) => void queued.push([runId, ...leads.map((l) => l.leadId)]);

    // Research not finished for all leads yet → no batch.
    expect((await processLead(c.leads[0], deps)).outcome).toBe("deferred");
    expect(await submitPending(pool, llm, enqueue)).toEqual({ batches: 0, items: 0 });
    // A retried job doesn't create a second waiting item.
    expect((await processLead(c.leads[0], deps)).outcome).toBe("deferred");

    for (const id of c.leads.slice(1)) expect((await processLead(id, deps)).outcome).toBe("deferred");
    expect(await balance(pool, ws)).toMatchObject({ reserved: 3, spent: 0 });
    expect(await submitPending(pool, llm, enqueue)).toEqual({ batches: 1, items: 3 });
    expect(state.submitted).toHaveLength(1);
    expect(await submitPending(pool, llm, enqueue)).toEqual({ batches: 0, items: 0 }); // not twice

    // Not ended yet → nothing to collect.
    expect(await collectFinished(pool, llm, enqueue)).toEqual({ batches: 0, done: 0, errors: 0 });
    state.ended = true;
    expect(await collectFinished(pool, llm, enqueue)).toEqual({ batches: 1, done: 3, errors: 0 });
    expect(queued.at(-1)!.slice(1).sort()).toEqual([...c.leads].sort());
    expect(await collectFinished(pool, llm, enqueue)).toEqual({ batches: 0, done: 0, errors: 0 }); // only once

    for (const id of c.leads) expect((await processLead(id, deps)).outcome).toBe("done");
    expect(await balance(pool, ws)).toMatchObject({ reserved: 0, spent: 3 });
    const { rows: costs } = await pool.query("select model, cost_usd::float, campaign_id from public.usage_costs where model like '%batch%'");
    expect(costs).toHaveLength(3);
    expect(costs[0]).toEqual({ model: "claude-sonnet-5-5 (batch)", cost_usd: 0.004, campaign_id: c.id });
    expect((await pool.query("select count(*)::int n from public.batch_items where status <> 'consumed'")).rows[0].n).toBe(0);
  });

  it("an item the batch failed on is written directly", async () => {
    let failing: string[] = [];
    const { llm, state } = testLLM({ failIds: () => failing });
    const deps = { store: new PgStore(pool), reader, llm, config: engineConfig({}) };
    const c = await campaign("eco-fail", 2);
    const enqueue = async () => {};
    for (const id of c.leads) await processLead(id, deps);
    await submitPending(pool, llm, enqueue);
    failing = [(await pool.query("select id from public.batch_items where lead_id = $1", [c.leads[0]])).rows[0].id];
    state.ended = true;
    expect(await collectFinished(pool, llm, enqueue)).toMatchObject({ done: 1, errors: 1 });
    for (const id of c.leads) expect((await processLead(id, deps)).outcome).toBe("done");
  });

  it("stopping the campaign while leads wait gives the credits back and skips them", async () => {
    const { llm } = testLLM();
    const deps = { store: new PgStore(pool), reader, llm, config: engineConfig({}) };
    const c = await campaign("eco-stop", 2);
    for (const id of c.leads) await processLead(id, deps);
    const before = await balance(pool, ws);
    await stopRun(pool, ws, c.id);
    expect((await balance(pool, ws)).available).toBe(before.available + 2);

    const back: string[] = [];
    expect(await submitPending(pool, llm, async (leads) => void back.push(...leads.map((l) => l.leadId)))).toEqual({ batches: 0, items: 0 });
    expect(back.sort()).toEqual([...c.leads].sort());
    for (const id of c.leads) expect(await processLead(id, deps)).toMatchObject({ outcome: "skipped", detail: "Run stopped" });
    expect((await pool.query("select count(*)::int n from public.batch_items where status <> 'consumed'")).rows[0].n).toBe(0);
  });
});

describe("Quality Lab (database)", () => {
  it("queues a run, runs it in the background and stores the result", async () => {
    const { queueEvalRun, runQueuedEval, saveTestSet, upsertSkills } = await import("@/engine/lab-pg");
    const { MemoryStore } = await import("@/engine/store");
    await upsertSkills(pool, "1.0");
    await saveTestSet(pool, {
      id: "t",
      name: "Test",
      template: { subject: "Idee voor {{company}}", body: "Hoi {{first_name}},\n\n[[opener · iets specifieks van hun website · 25]]\n\nGroet" },
      leads: [{ first_name: "Pieter", company: "Bos", title: null, domain: "bakkerij.nl" }],
    });
    const id = await queueEvalRun(pool, { testSetId: "t", candidate: "1.0", baseline: "1.0", provider: "fake" });
    const deps = { store: new MemoryStore(), reader, llm: new FakeLLM(), config: engineConfig({}) };
    expect(await runQueuedEval(pool, deps)).toBe(id);
    expect(await runQueuedEval(pool, deps)).toBeNull(); // nothing left
    const run = (await pool.query("select status, ties, wins, losses, details, provider from public.eval_runs where id = $1", [id])).rows[0];
    expect(run).toMatchObject({ status: "done", ties: 1, wins: 0, losses: 0, provider: "fake" });
    expect(run.details[0]).toMatchObject({ domain: "bakkerij.nl", winner: "tie" });
    expect((await pool.query("select status from public.skill_versions where version = '1.0'")).rows[0].status).toBe("live");
  });

  it("a run on a missing test set fails with a clear error", async () => {
    const { queueEvalRun, runQueuedEval } = await import("@/engine/lab-pg");
    const { MemoryStore } = await import("@/engine/store");
    const id = await queueEvalRun(pool, { testSetId: "nope", candidate: "1.0", baseline: "1.0", provider: "fake" });
    await runQueuedEval(pool, { store: new MemoryStore(), reader, llm: new FakeLLM(), config: engineConfig({}) });
    expect((await pool.query("select status, error from public.eval_runs where id = $1", [id])).rows[0]).toEqual({ status: "failed", error: 'Test set "nope" not found' });
  });
});
