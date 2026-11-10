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
    expect(await balance(pool, ws)).toEqual({ available: 5, reserved: 0, spent: 0 });
  });

  it("refuses a run it can't pay for, without reserving anything", async () => {
    const ids = [await lead("a@bos1.nl", "bakkerij.nl"), await lead("b@bos2.nl", "bakkerij.nl"), await lead("c@bos3.nl", "bakkerij.nl")];
    expect(await reserveForRun(pool, { workspaceId: ws, leadIds: ids, perLead: 2 })).toEqual({ ok: false, need: 6, available: 5 });
    expect((await balance(pool, ws)).reserved).toBe(0);
  });

  it("reserves, then the pipeline captures what a written lead used and releases the rest", async () => {
    const id = await lead("d@bos4.nl", "bakkerij.nl");
    expect(await reserveForRun(pool, { workspaceId: ws, leadIds: [id], perLead: 2 })).toEqual({ ok: true, reserved: 1, credits: 2 });
    expect(await balance(pool, ws)).toEqual({ available: 3, reserved: 2, spent: 0 });
    // Reserving again (a retried run) charges nothing extra.
    expect(await reserveForRun(pool, { workspaceId: ws, leadIds: [id], perLead: 2 })).toEqual({ ok: true, reserved: 0, credits: 0 });

    const res = await processLead(id, { store: new PgStore(pool), reader, llm: new FakeLLM(), config: engineConfig({}) });
    expect(res.outcome).toBe("done");
    // 1 for the email (no personalised follow-ups); the second reserved credit comes back.
    expect(await balance(pool, ws)).toEqual({ available: 4, reserved: 0, spent: 1 });
  });

  it("a lead without a website falls back for free", async () => {
    const id = await lead("e@nosite.nl", null);
    await reserveForRun(pool, { workspaceId: ws, leadIds: [id], perLead: 1 });
    expect((await processLead(id, { store: new PgStore(pool), reader, llm: new FakeLLM(), config: engineConfig({}) })).outcome).toBe("fallback");
    expect(await balance(pool, ws)).toEqual({ available: 4, reserved: 0, spent: 1 });
  });

  it("stopping a run gives back every open reservation and skips leads not started", async () => {
    const ids = [await lead("f@bos5.nl", "bakkerij.nl"), await lead("g@bos6.nl", "bakkerij.nl")];
    await reserveForRun(pool, { workspaceId: ws, leadIds: ids, perLead: 1 });
    expect((await balance(pool, ws)).reserved).toBe(2);
    expect(await stopRun(pool, ws, campaign)).toMatchObject({ released: 2 });
    expect(await balance(pool, ws)).toEqual({ available: 4, reserved: 0, spent: 1 });
    expect((await pool.query("select status from public.leads where id = $1", [ids[0]])).rows[0].status).toBe("skipped");
    // A job that was already queued for it does nothing and costs nothing.
    expect((await processLead(ids[1], { store: new PgStore(pool), reader, llm: new FakeLLM(), config: engineConfig({}) })).outcome).toBe("skipped");
    expect(await balance(pool, ws)).toEqual({ available: 4, reserved: 0, spent: 1 });
  });
});
