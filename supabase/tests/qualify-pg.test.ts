// Lead qualification (Part B) on a real Postgres 17 (embedded) with the fake LLM and a fake website:
// verdicts on the lead and in the per-campaign cache, credits released for skipped leads, "write
// anyway", the campaign counts and warning, the outcome rows, the admin numbers, the API fields, the
// Lab's qualification test, and that the new server-only tables are closed to logged-in users.
import EmbeddedPostgres from "embedded-postgres";
import { mkdtempSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createApiKey, createJob, jobView } from "@/api/core-pg";
import { PersonalizeBody, normaliseSource } from "@/api/schemas";
import { loadCostBreakdown, loadFreeSkips, loadNoFitCampaigns } from "@/billing/admin-db";
import { reserveForRun } from "@/billing/db";
import { engineConfig } from "@/engine/config";
import type { WebReader } from "@/engine/firecrawl";
import type { LLM } from "@/engine/llm";
import { FakeLLM } from "@/engine/llm-fake";
import { processLead } from "@/engine/pipeline";
import { queueQualifyTest, runQueuedQualifyTest } from "@/engine/qualify-test-pg";
import { PgStore } from "@/engine/store-pg";
import { qualificationSummary, writeAnyway } from "@/lib/qualify-pg";
import type { TargetCustomer } from "@/lib/target-customer";
import { freePort } from "./free-port";

const root = path.resolve(__dirname, "..");
const USER = "00000000-0000-4000-8000-0000000000af";
let server: EmbeddedPostgres;
let pool: pg.Pool;
let dir: string;
let ws: string;

const SITE: Record<string, string> = {
  "https://acmestudio.nl/": "# Acme Studio\n\nAcme Studio designs packaging for independent food brands across the Netherlands. From the first sketch to the printed box, one team handles the whole process for each client.",
  "https://acmestudio.nl/over-ons": "# Over ons\n\nWe started in 2012 as a two-person studio in Utrecht and now have a team of twelve designers.\n\nWe opened a second studio in Rotterdam this autumn for our growing client base.",
};
const reader: WebReader = {
  robots: async () => null,
  map: async () => ({ links: Object.keys(SITE).map((url) => ({ url })), credits: 1 }),
  scrape: async (url) => ({ markdown: SITE[url] ?? "", statusCode: SITE[url] ? 200 : 404, credits: 1 }),
};
const config = engineConfig({});
/** The fake LLM, with a priced qualify call so cost logging is visible. */
function pricedLLM(): LLM {
  const f = new FakeLLM();
  return {
    provider: "fake",
    extractorId: f.extractorId,
    extractFacts: (i) => f.extractFacts(i),
    write: (i) => f.write(i),
    judge: () => f.judge(),
    qualify: async (i) => ({ ...(await f.qualify(i)), costs: [{ step: "qualify", model: "deepseek-flash", input_tokens: 900, output_tokens: 80, cost_usd: 0.0002 }] }),
  };
}
const deps = () => ({ store: new PgStore(pool), reader, llm: pricedLLM(), config, now: () => new Date() });

const EXCLUDED: TargetCustomer = { fits: "packaging design", excludes: "food brands", strictness: "normal" };
const FITS: TargetCustomer = { fits: "packaging design", excludes: "", strictness: "normal" };

beforeAll(async () => {
  dir = mkdtempSync(path.join(tmpdir(), "firstline-qualify-"));
  const port = await freePort();
  server = new EmbeddedPostgres({ databaseDir: dir, user: "postgres", password: "test", port, persistent: false, onLog: () => {} });
  await server.initialise();
  await server.start();
  pool = new pg.Pool({ host: "127.0.0.1", port, user: "postgres", password: "test", database: "postgres", max: 10 });
  await pool.query(readFileSync(path.join(root, "tests/supabase-shim.sql"), "utf8"));
  for (const f of readdirSync(path.join(root, "migrations")).filter((f) => f.endsWith(".sql")).sort()) {
    await pool.query(readFileSync(path.join(root, "migrations", f), "utf8"));
  }
  await pool.query("insert into auth.users (id, email, email_confirmed_at) values ($1, 'me@fit.nl', now())", [USER]);
  ws = (await pool.query("select id from public.workspaces where owner_id = $1", [USER])).rows[0].id;
  await pool.query("select public.add_purchase($1, 100, 'test:qualify', 'test credits', 'standard')", [ws]);
}, 120_000);

afterAll(async () => {
  await pool?.end();
  await server?.stop();
  rmSync(dir, { recursive: true, force: true });
});

async function template() {
  return (
    await pool.query(
      "insert into public.templates (workspace_id, name, subject, body, slots, style_rules) values ($1, 'T', 'Idea for {{company}}', $2, '[]', '{\"language\":\"en\"}') returning id",
      [ws, "Hi {{first_name}},\n\n[[opener · something specific from their website · 25]]\n\nWorth a look?"],
    )
  ).rows[0].id as string;
}

async function campaign(target: TargetCustomer | null, emails: string[], status = "running") {
  const c = (
    await pool.query("insert into public.campaigns (workspace_id, name, template_id, status, target_customer) values ($1, 'Fit', $2, $3, $4) returning id", [
      ws,
      await template(),
      status,
      target ? JSON.stringify(target) : null,
    ])
  ).rows[0].id as string;
  const leads: string[] = [];
  for (const e of emails) {
    leads.push(
      (
        await pool.query(
          "insert into public.leads (workspace_id, campaign_id, email, first_name, company, title, website, domain, created_at) values ($1, $2, $3, 'Anna', 'Acme Studio', 'Founder', 'acmestudio.nl', 'acmestudio.nl', clock_timestamp()) returning id",
          [ws, c, e],
        )
      ).rows[0].id,
    );
  }
  return { id: c, leads };
}
const balance = () => pool.query("select available, reserved from public.workspace_balance where workspace_id = $1", [ws]).then((r) => r.rows[0]);
const lead = (id: string) =>
  pool.query("select status, status_detail, qualify_verdict, qualify_reason, qualify_facts, qualify_criteria, qualify_override from public.leads where id = $1", [id]).then((r) => r.rows[0]);

describe("lead qualification (database)", () => {
  it("target_customer only accepts a known strictness", async () => {
    await expect(pool.query("insert into public.campaigns (workspace_id, name, target_customer) values ($1, 'x', '{\"fits\":\"a\",\"strictness\":\"very\"}')", [ws])).rejects.toThrow(
      /check constraint/,
    );
  });

  it("no_fit: verdict stored on the lead, one cached verdict per campaign + domain, reserved credits back, cost logged as qualify", async () => {
    const c = await campaign(EXCLUDED, ["a@acmestudio.nl", "b@acmestudio.nl"]);
    const before = await balance();
    await reserveForRun(pool, { workspaceId: ws, leadIds: c.leads, perLead: 1 });
    for (const id of c.leads) expect((await processLead(id, deps())).outcome).toBe("skipped");
    expect(await balance()).toEqual(before); // both reservations released, nothing captured
    const l = await lead(c.leads[0]);
    expect(l).toMatchObject({ status: "skipped", qualify_verdict: "no_fit", qualify_override: false });
    expect(l.status_detail).toMatch(/^Not a fit: /);
    expect(l.qualify_facts).toHaveLength(1);
    expect(l.qualify_criteria.cited[0].text).toMatch(/food brands/);
    expect((await pool.query("select count(*)::int n from public.qualification_cache where campaign_id = $1", [c.id])).rows[0].n).toBe(1);
    const costs = (await pool.query("select step, campaign_id from public.usage_costs where lead_id = any($1) and step = 'qualify'", [c.leads])).rows;
    expect(costs).toEqual([{ step: "qualify", campaign_id: c.id }]); // the second lead used the cache
    expect((await pool.query("select count(*)::int n from public.generations where lead_id = any($1)", [c.leads])).rows[0].n).toBe(0);
  });

  it("write anyway while running: credits reserved now, the lead is written without the check and charged", async () => {
    const c = await campaign(EXCLUDED, ["anyway@acmestudio.nl"]);
    await processLead(c.leads[0], deps());
    const before = await balance();
    const r = await writeAnyway(pool, { workspaceId: ws, leadId: c.leads[0], deepOn: false });
    expect(r).toEqual({ ok: true, enqueue: "run", credits: 1 });
    expect(await balance()).toEqual({ available: before.available - 1, reserved: before.reserved + 1 });
    expect(await lead(c.leads[0])).toMatchObject({ status: "queued", qualify_override: true });
    expect((await processLead(c.leads[0], deps(), { force: true })).outcome).toBe("done");
    expect(await balance()).toEqual({ available: before.available - 1, reserved: before.reserved });
    // Only once, and never for another workspace's lead or a lead the check didn't skip.
    expect(await writeAnyway(pool, { workspaceId: ws, leadId: c.leads[0], deepOn: false })).toMatchObject({ error: expect.any(String) });
    expect(await writeAnyway(pool, { workspaceId: "00000000-0000-4000-8000-000000000000", leadId: c.leads[0], deepOn: false })).toEqual({ error: "Lead not found." });
  });

  it("write anyway before the run: no credits now; a preview lead is written free with the preview", async () => {
    const c = await campaign(EXCLUDED, ["pre@acmestudio.nl", "pre2@acmestudio.nl"], "preview");
    await pool.query("update public.leads set preview_rank = 1 where id = $1", [c.leads[0]]);
    for (const id of c.leads) await processLead(id, deps(), { preview: true, force: true });
    const before = await balance();
    expect(await writeAnyway(pool, { workspaceId: ws, leadId: c.leads[0], deepOn: false })).toEqual({ ok: true, enqueue: "preview", credits: 0 });
    expect(await writeAnyway(pool, { workspaceId: ws, leadId: c.leads[1], deepOn: false })).toEqual({ ok: true, enqueue: null, credits: 0 });
    expect(await balance()).toEqual(before);
  });

  it("campaign counts, the free skips and the >50% warning from 10 checked leads", async () => {
    const c = await campaign(EXCLUDED, Array.from({ length: 10 }, (_, i) => `w${i}@acmestudio.nl`));
    for (const id of c.leads.slice(0, 9)) await processLead(id, deps());
    expect((await qualificationSummary(pool, ws, c.id)).warning).toBe(false); // 9 checked
    await processLead(c.leads[9], deps());
    const s = await qualificationSummary(pool, ws, c.id);
    expect(s).toMatchObject({ on: true, counts: { fit: 0, no_fit: 10, unsure: 0 }, skipped: 10, warning: true });
    expect((await loadNoFitCampaigns(pool)).map((x) => x.id)).toContain(c.id);
    const free = await loadFreeSkips(pool, 30);
    expect(free.leads).toBeGreaterThanOrEqual(10);
    expect(free.costUsd).toBeGreaterThan(0);
  });

  it("a fit lead is written; its outcome row keeps the verdict", async () => {
    const c = await campaign(FITS, ["fit@acmestudio.nl"]);
    await reserveForRun(pool, { workspaceId: ws, leadIds: c.leads, perLead: 1 });
    expect((await processLead(c.leads[0], deps())).outcome).toBe("done");
    await pool.query("select public.record_outcomes($1::uuid[], 1, 'csv', 'exported')", [c.leads]);
    expect((await pool.query("select qualify_verdict from public.outcomes where lead_id = $1", [c.leads[0]])).rows[0].qualify_verdict).toBe("fit");
  });

  it("API: target_customer and options.qualify; the verdict and reason in the result", async () => {
    const { row } = await createApiKey(pool, ws, "fit", USER);
    const caller = { apiKeyId: row.id, workspaceId: ws };
    const copy = { subject: "Idea", body: "Hi {{first_name}},\n\n[[opener · something specific · 25]]\n\nBest" };
    const body = PersonalizeBody.parse(normaliseSource({ lead: { email: "api@acmestudio.nl", website: "acmestudio.nl" }, copy, target_customer: EXCLUDED }));
    const job = await createJob(pool, caller, { kind: "single", leads: [body.lead], source: body, idempotencyKey: null, requestHash: "h1" });
    await processLead(job.leadIds[0], deps());
    const view = (await jobView(pool, ws, job.jobId))!;
    expect(view.results[0]).toMatchObject({ status: "skipped", credits_used: 0, qualification: { verdict: "no_fit", reason: expect.any(String) } });

    // qualify off: no check, even with a target customer; the campaign's target is copied otherwise.
    const off = PersonalizeBody.parse(normaliseSource({ lead: { email: "off@acmestudio.nl", website: "acmestudio.nl" }, copy, target_customer: EXCLUDED, options: { qualify: false } }));
    const job2 = await createJob(pool, caller, { kind: "single", leads: [off.lead], source: off, idempotencyKey: null, requestHash: "h2" });
    await processLead(job2.leadIds[0], deps());
    expect((await jobView(pool, ws, job2.jobId))!.results[0]).toMatchObject({ status: "personalised", qualification: null });

    const appCampaign = await campaign(EXCLUDED, [], "draft");
    const viaCampaign = PersonalizeBody.parse(normaliseSource({ lead: { email: "camp@acmestudio.nl", website: "acmestudio.nl" }, campaign_id: appCampaign.id }));
    const job3 = await createJob(pool, caller, { kind: "single", leads: [viaCampaign.lead], source: viaCampaign, idempotencyKey: null, requestHash: "h3" });
    const tc = (await pool.query("select c.target_customer from public.api_jobs j join public.campaigns c on c.id = j.campaign_id where j.id = $1", [job3.jobId])).rows[0];
    expect(tc.target_customer).toEqual(EXCLUDED);
  });

  it("Lab qualification test: queued with approval, run by the worker, costs counted as Lab", async () => {
    const leads = [
      { domain: "acmestudio.nl", company: "Acme", title: null, target: FITS, shouldFit: true },
      { domain: "acmestudio.nl", company: "Acme", title: null, target: EXCLUDED, shouldFit: false },
    ];
    const id = await queueQualifyTest(pool, { leads, provider: "fake", approvedBy: "owner@firstline" });
    expect(await runQueuedQualifyTest(pool, { reader, config, llm: pricedLLM() })).toBe(id);
    const run = (await pool.query("select status, report, cost_usd from public.qualify_test_runs where id = $1", [id])).rows[0];
    expect(run.status).toBe("done");
    expect(run.report).toMatchObject({ leads: 2, accuracy: 1, falseNoFitRate: 0 });
    expect(Number(run.cost_usd)).toBeCloseTo(0.0004);
    expect((await loadCostBreakdown(pool)).find((r) => r.step === "qualify" && r.source === "lab")).toBeDefined();
    expect(await runQueuedQualifyTest(pool, { reader, config, llm: pricedLLM() })).toBeNull();
  });

  it("the cache and the Lab runs are server-only: logged-in users can't read them", async () => {
    const c = await pool.connect();
    try {
      await c.query("set role authenticated");
      await expect(c.query("select * from public.qualification_cache")).rejects.toThrow(/permission denied/);
      await expect(c.query("select * from public.qualify_test_runs")).rejects.toThrow(/permission denied/);
    } finally {
      await c.query("reset role");
      c.release();
    }
  });
});
