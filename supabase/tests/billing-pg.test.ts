// Integration: credits on a real Postgres 17 (embedded). Purchase (idempotent) → reserve for a run
// → the pipeline captures what a written lead used and releases the rest → stop a run.
import EmbeddedPostgres from "embedded-postgres";
import { mkdtempSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { addPurchase, balance, reserveForRun, stopRun } from "@/billing/db";
import { engineConfig } from "@/engine/config";
import type { WebReader } from "@/engine/firecrawl";
import { FakeLLM } from "@/engine/llm-fake";
import { processLead } from "@/engine/pipeline";
import { PgStore } from "@/engine/store-pg";

const root = path.resolve(__dirname, "..");
const USER = "00000000-0000-0000-0000-0000000000bb";
let server: EmbeddedPostgres;
let pool: pg.Pool;
let dir: string;
let ws: string;
let campaign: string;
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

async function lead(email: string, domain: string | null) {
  return (
    await pool.query("insert into public.leads (workspace_id, campaign_id, email, first_name, company, domain, created_at) values ($1, $2, $3, 'X', 'Bos', $4, clock_timestamp()) returning id", [
      ws,
      campaign,
      email,
      domain,
    ])
  ).rows[0].id as string;
}

beforeAll(async () => {
  dir = mkdtempSync(path.join(tmpdir(), "firstline-bill-"));
  const port = 48_000 + Math.floor(Math.random() * 4_000);
  server = new EmbeddedPostgres({ databaseDir: dir, user: "postgres", password: "test", port, persistent: false, onLog: () => {} });
  await server.initialise();
  await server.start();
  pool = new pg.Pool({ host: "127.0.0.1", port, user: "postgres", password: "test", database: "postgres", max: 10 });
  await pool.query(readFileSync(path.join(root, "tests/supabase-shim.sql"), "utf8"));
  for (const f of readdirSync(path.join(root, "migrations")).filter((f) => f.endsWith(".sql")).sort()) {
    await pool.query(readFileSync(path.join(root, "migrations", f), "utf8"));
  }
  await pool.query("insert into auth.users (id, email) values ($1, 'owner@bos-bill.nl')", [USER]); // not verified: no welcome credits
  ws = (await pool.query("select id from public.workspaces where owner_id = $1", [USER])).rows[0].id;
  template = (
    await pool.query(
      `insert into public.templates (workspace_id, name, subject, body) values ($1, 'T', 'Idee voor {{company}}',
       'Hoi {{first_name}},\n\n[[opener · iets specifieks van hun website · 25]]\n\nGroet') returning id`,
      [ws],
    )
  ).rows[0].id;
  campaign = (await pool.query("insert into public.campaigns (workspace_id, name, template_id, status) values ($1, 'C', $2, 'running') returning id", [ws, template])).rows[0].id;
}, 120_000);

afterAll(async () => {
  await pool?.end();
  await server?.stop();
  rmSync(dir, { recursive: true, force: true });
});

describe("credits", () => {
  it("a purchase is added once, however often Stripe sends the webhook", async () => {
    expect(await addPurchase(pool, { workspaceId: ws, credits: 5, key: "checkout:cs_1", note: "Starter" })).toBe(true);
    expect(await addPurchase(pool, { workspaceId: ws, credits: 5, key: "checkout:cs_1", note: "Starter" })).toBe(false);
    expect(await balance(pool, ws)).toEqual({ available: 5, reserved: 0, spent: 0, lite_available: 0 });
  });

  it("refuses a run it can't pay for, without reserving anything", async () => {
    const ids = [await lead("a@bos1.nl", "bakkerij.nl"), await lead("b@bos2.nl", "bakkerij.nl"), await lead("c@bos3.nl", "bakkerij.nl")];
    expect(await reserveForRun(pool, { workspaceId: ws, leadIds: ids, perLead: 2 })).toEqual({ ok: false, need: 6, available: 5 });
    expect((await balance(pool, ws)).reserved).toBe(0);
  });

  it("reserves, then the pipeline captures what a written lead used and releases the rest", async () => {
    const id = await lead("d@bos4.nl", "bakkerij.nl");
    expect(await reserveForRun(pool, { workspaceId: ws, leadIds: [id], perLead: 2 })).toEqual({ ok: true, reserved: 1, credits: 2 });
    expect(await balance(pool, ws)).toEqual({ available: 3, reserved: 2, spent: 0, lite_available: 0 });
    // Reserving again (a retried run) charges nothing extra.
    expect(await reserveForRun(pool, { workspaceId: ws, leadIds: [id], perLead: 2 })).toEqual({ ok: true, reserved: 0, credits: 0 });

    const res = await processLead(id, { store: new PgStore(pool), reader, llm: new FakeLLM(), config: engineConfig({}) });
    expect(res.outcome).toBe("done");
    // 1 for the email (no personalised follow-ups); the second reserved credit comes back.
    expect(await balance(pool, ws)).toEqual({ available: 4, reserved: 0, spent: 1, lite_available: 0 });
  });

  it("a lead without a website falls back for free", async () => {
    const id = await lead("e@nosite.nl", null);
    await reserveForRun(pool, { workspaceId: ws, leadIds: [id], perLead: 1 });
    expect((await processLead(id, { store: new PgStore(pool), reader, llm: new FakeLLM(), config: engineConfig({}) })).outcome).toBe("fallback");
    expect(await balance(pool, ws)).toEqual({ available: 4, reserved: 0, spent: 1, lite_available: 0 });
  });

  it("stopping a run gives back every open reservation and skips leads not started", async () => {
    const ids = [await lead("f@bos5.nl", "bakkerij.nl"), await lead("g@bos6.nl", "bakkerij.nl")];
    await reserveForRun(pool, { workspaceId: ws, leadIds: ids, perLead: 1 });
    expect((await balance(pool, ws)).reserved).toBe(2);
    expect(await stopRun(pool, ws, campaign)).toMatchObject({ released: 2 });
    expect(await balance(pool, ws)).toEqual({ available: 4, reserved: 0, spent: 1, lite_available: 0 });
    expect((await pool.query("select status from public.leads where id = $1", [ids[0]])).rows[0].status).toBe("skipped");
    // A job that was already queued for it does nothing and costs nothing.
    expect((await processLead(ids[1], { store: new PgStore(pool), reader, llm: new FakeLLM(), config: engineConfig({}) })).outcome).toBe("skipped");
    expect(await balance(pool, ws)).toEqual({ available: 4, reserved: 0, spent: 1, lite_available: 0 });
  });
});

describe("Kelviq", () => {
  const SECRET = "kq_whsec_test_secret";
  const plans = { starter: "firstline-starter", growth: "firstline-growth", agency: "firstline-agency" } as const;

  async function signed(body: object, opts: { secret?: string; ts?: number; id?: string } = {}) {
    const { createHmac } = await import("node:crypto");
    const raw = JSON.stringify(body);
    const id = opts.id ?? "4f2c7c3e-0000-4000-8000-000000000001";
    const ts = String(opts.ts ?? Math.floor(Date.now() / 1000));
    const sig = createHmac("sha256", opts.secret ?? SECRET).update(`${id}.${ts}.${raw}`, "utf8").digest("hex");
    return { raw, headers: { "webhook-id": id, "webhook-timestamp": ts, "webhook-signature": `v1,${sig}` } };
  }
  const completed = (over: Record<string, unknown> = {}) => ({
    id: "evt-1",
    type: "checkout.completed",
    test: true,
    data: { object: { id: "cs_test_1", status: "success", checkout_type: "ONE_TIME", amount: "19.00", currency: "EUR", plan: { identifier: "firstline-starter" }, metadata: { workspace_id: ws, pack: "starter", credits: 500 }, ...over } },
  });

  it("checkout: the pack's plan, the workspace as customer, metadata for the webhook", async () => {
    const { createKelviqCheckout } = await import("@/billing/kelviq");
    const calls: unknown[] = [];
    const fake = { createSession: async (p: unknown) => (calls.push(p), { checkoutUrl: "https://kelviq.com/checkout/cs_test_1", checkoutSessionId: "cs_test_1" }) };
    expect(await createKelviqCheckout(fake, { workspaceId: ws, pack: "growth", origin: "https://app.test", plans })).toBe("https://kelviq.com/checkout/cs_test_1");
    expect(calls[0]).toEqual({
      planIdentifier: "firstline-growth",
      chargePeriod: "ONE_TIME",
      customerId: ws,
      successUrl: "https://app.test/credits?paid=1",
      metadata: { workspace_id: ws, pack: "growth", credits: 2000 },
    });
  });

  it("webhook signature: valid accepted; wrong secret, tampered body or old timestamp rejected", async () => {
    const { verifyKelviqWebhook } = await import("@/billing/kelviq");
    const ok = await signed(completed());
    expect(verifyKelviqWebhook(ok.raw, ok.headers, SECRET).type).toBe("checkout.completed");
    const wrong = await signed(completed(), { secret: "kq_whsec_other" });
    expect(() => verifyKelviqWebhook(wrong.raw, wrong.headers, SECRET)).toThrow(/verification failed/);
    expect(() => verifyKelviqWebhook(ok.raw.replace("500", "50000"), ok.headers, SECRET)).toThrow(/verification failed/);
    const old = await signed(completed(), { ts: Math.floor(Date.now() / 1000) - 3600 });
    expect(() => verifyKelviqWebhook(old.raw, old.headers, SECRET)).toThrow(/too old/);
  });

  it("a completed checkout adds the pack's credits once, however often Kelviq delivers it", async () => {
    const { handleKelviqEvent } = await import("@/billing/kelviq");
    const before = (await balance(pool, ws)).available;
    expect(await handleKelviqEvent(pool, completed(), plans)).toEqual({ handled: true, added: 500 });
    expect(await handleKelviqEvent(pool, completed(), plans)).toEqual({ handled: true, added: 0 });
    expect((await balance(pool, ws)).available).toBe(before + 500);
    const note = (await pool.query("select note from public.credit_ledger where stripe_event_id = 'kelviq:cs_test_1'")).rows[0].note;
    expect(note).toBe("Starter pack (starter): 500 credits · Kelviq · 19.00 EUR paid (test)");
  });

  it("falls back to the plan identifier; ignores other events, other products and unfinished checkouts", async () => {
    const { handleKelviqEvent } = await import("@/billing/kelviq");
    const noPack = completed({ id: "cs_test_2", plan: { identifier: "firstline-agency" }, metadata: { workspace_id: ws } });
    expect(await handleKelviqEvent(pool, noPack, plans)).toEqual({ handled: true, added: 10000 });
    expect((await handleKelviqEvent(pool, completed({ id: "cs_test_3", plan: { identifier: "other-product" }, metadata: {} }), plans)).added).toBe(0);
    expect((await handleKelviqEvent(pool, completed({ id: "cs_test_4", status: "pending" }), plans)).added).toBe(0);
    expect((await handleKelviqEvent(pool, { ...completed(), type: "order.created" }, plans)).handled).toBe(false);
  });
});

describe("admin margin view", () => {
  it("adds up credits, real costs and margin per campaign and per day, across workspaces", async () => {
    const { loadAdmin } = await import("@/billing/admin-db");
    await pool.query("insert into public.usage_costs (workspace_id, step, model, cost_usd, campaign_id) values ($1, 'write', 'claude-sonnet-5-5', 0.05, $2)", [ws, campaign]);
    const a = await loadAdmin(pool);
    const c = a.campaigns.find((x) => x.id === campaign)!;
    expect(c.creditsUsed).toBe(1); // one written lead in the credit tests above
    expect(c.emails).toBe(1);
    expect(c.costUsd).toBeCloseTo(0.05);
    expect(c.m.costEur).toBeCloseTo(0.05 * 0.92);
    // Purchases in these tests: Starter (Kelviq checkout) and Agency (plan fallback) → weighted price per credit.
    expect(a.perCreditEur).toBeGreaterThan(0.029);
    expect(a.perCreditEur).toBeLessThan(0.039);
    expect(a.days).toHaveLength(30);
    expect(a.days[0].creditsUsed).toBeGreaterThanOrEqual(1);
    expect(a.workspaces.find((w) => w.id === ws)).toMatchObject({ senderDisabled: false, personalShare: 0 });
    expect(a.drift.level).toBe("ok"); // fewer than 20 emails: no alert
  });
});

describe("data retention (§11)", () => {
  it("ending a campaign releases credits and stops sending; 30 days later its lead data is gone, the money history stays", async () => {
    const { endCampaign, runRetention } = await import("@/billing/retention");
    const c = (await pool.query("insert into public.campaigns (workspace_id, name, template_id, status) values ($1, 'Ends', $2, 'running') returning id", [ws, template])).rows[0].id;
    const id = (await pool.query("insert into public.leads (workspace_id, campaign_id, email, domain) values ($1, $2, 'r@ret.nl', 'ret.nl') returning id", [ws, c])).rows[0].id;
    await pool.query("insert into public.generations (lead_id, workspace_id, subject, full_email, slot_outputs) values ($1, $2, 's', 'e', '{}')", [id, ws]);
    await pool.query("insert into public.usage_costs (workspace_id, step, model, cost_usd, lead_id, campaign_id) values ($1, 'write', 'x', 0.01, $2, $3)", [ws, id, c]);
    await reserveForRun(pool, { workspaceId: ws, leadIds: [id], perLead: 1 });
    const before = (await balance(pool, ws)).available;

    expect(await endCampaign(pool, ws, c)).toBe(true);
    expect(await endCampaign(pool, ws, c)).toBe(false); // once
    expect((await balance(pool, ws)).available).toBe(before + 1);
    expect((await pool.query("select status, send_state from public.campaigns where id = $1", [c])).rows[0]).toEqual({ status: "done", send_state: null });

    expect((await runRetention(pool, new Date(Date.now() + 29 * 86_400_000))).purged).toBe(0);
    const later = await runRetention(pool, new Date(Date.now() + 31 * 86_400_000));
    expect(later).toMatchObject({ purged: 1, leadsDeleted: 1 });
    expect((await pool.query("select count(*)::int n from public.leads where campaign_id = $1", [c])).rows[0].n).toBe(0);
    expect((await pool.query("select count(*)::int n from public.generations where lead_id = $1", [id])).rows[0].n).toBe(0);
    // Ledger and costs stay (no personal data); the campaign row stays, marked purged.
    expect((await pool.query("select count(*)::int n from public.credit_ledger where lead_id = $1", [id])).rows[0].n).toBeGreaterThan(0);
    expect((await pool.query("select lead_id, campaign_id from public.usage_costs where campaign_id = $1", [c])).rows[0]).toEqual({ lead_id: null, campaign_id: c });
    expect((await pool.query("select purged_at is not null p from public.campaigns where id = $1", [c])).rows[0].p).toBe(true);
    expect((await runRetention(pool, new Date(Date.now() + 32 * 86_400_000))).purged).toBe(0); // once
  });

  it("a campaign without any activity for 90 days ends by itself", async () => {
    const { runRetention } = await import("@/billing/retention");
    const c = (await pool.query("insert into public.campaigns (workspace_id, name, status, created_at) values ($1, 'Idle', 'preview', now() - interval '100 days') returning id", [ws])).rows[0].id;
    await pool.query("insert into public.leads (workspace_id, campaign_id, email, created_at) values ($1, $2, 'i@idle.nl', now() - interval '100 days')", [ws, c]);
    expect((await runRetention(pool)).ended).toBeGreaterThanOrEqual(1);
    expect((await pool.query("select ended_at is not null e from public.campaigns where id = $1", [c])).rows[0].e).toBe(true);
  });
});
