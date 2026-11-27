// Fixes from the review of 2026-11-26, on a real Postgres 17 (embedded):
//   S1 a lead whose reservation was settled is charged again when it runs again (stop → restart,
//      "write anyway" during a run), while a retry still never reserves twice;
//   S4 releasing a failed lead's reservation, and running it again;
//   S3 outgoing webhooks refuse hosts that resolve to internal addresses.
import EmbeddedPostgres from "embedded-postgres";
import { mkdtempSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createEndpoint, deliverDue, endpointHostProblem } from "@/api/webhooks-pg";
import { reserveForRun, stopRun } from "@/billing/db";
import { engineConfig } from "@/engine/config";
import type { WebReader } from "@/engine/firecrawl";
import { FakeLLM } from "@/engine/llm-fake";
import { processLead } from "@/engine/pipeline";
import { PgStore } from "@/engine/store-pg";
import { isPublicUrlHost } from "@/lib/public-host";
import { writeAnyway } from "@/lib/qualify-pg";
import { freePort } from "./free-port";

const root = path.resolve(__dirname, "..");
const USER = "00000000-0000-4000-8000-0000000000c1";
const KEY = Buffer.alloc(32, 7);
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
const deps = () => ({ store: new PgStore(pool), reader, llm: new FakeLLM(), config: engineConfig({}), now: () => new Date() });

beforeAll(async () => {
  dir = mkdtempSync(path.join(tmpdir(), "firstline-review-"));
  const port = await freePort();
  server = new EmbeddedPostgres({ databaseDir: dir, user: "postgres", password: "test", port, persistent: false, onLog: () => {} });
  await server.initialise();
  await server.start();
  pool = new pg.Pool({ host: "127.0.0.1", port, user: "postgres", password: "test", database: "postgres", max: 10 });
  await pool.query(readFileSync(path.join(root, "tests/supabase-shim.sql"), "utf8"));
  for (const f of readdirSync(path.join(root, "migrations")).filter((f) => f.endsWith(".sql")).sort()) {
    await pool.query(readFileSync(path.join(root, "migrations", f), "utf8"));
  }
  await pool.query("insert into auth.users (id, email, email_confirmed_at) values ($1, 'me@review.nl', now())", [USER]);
  ws = (await pool.query("select id from public.workspaces where owner_id = $1", [USER])).rows[0].id;
  await pool.query("select public.add_purchase($1, 100, 'test:review', 'test credits', 'standard')", [ws]);
}, 120_000);

afterAll(async () => {
  await pool?.end();
  await server?.stop();
  rmSync(dir, { recursive: true, force: true });
});

async function campaign(emails: string[], target: object | null = null) {
  const t = (
    await pool.query(
      "insert into public.templates (workspace_id, name, subject, body, slots, style_rules) values ($1, 'T', 'Idea for {{company}}', $2, '[]', '{\"language\":\"en\"}') returning id",
      [ws, "Hi {{first_name}},\n\n[[opener · something specific from their website · 25]]\n\nWorth a look?"],
    )
  ).rows[0].id;
  const c = (await pool.query("insert into public.campaigns (workspace_id, name, template_id, status, target_customer) values ($1, 'R', $2, 'running', $3) returning id", [ws, t, target ? JSON.stringify(target) : null])).rows[0].id as string;
  const leads: string[] = [];
  for (const e of emails) {
    leads.push(
      (
        await pool.query(
          "insert into public.leads (workspace_id, campaign_id, email, first_name, company, website, domain, created_at) values ($1, $2, $3, 'Anna', 'Acme Studio', 'acmestudio.nl', 'acmestudio.nl', clock_timestamp()) returning id",
          [ws, c, e],
        )
      ).rows[0].id,
    );
  }
  return { id: c, leads };
}
const balance = () => pool.query("select available, reserved, spent from public.workspace_balance where workspace_id = $1", [ws]).then((r) => r.rows[0]);
const rounds = (lead: string) => pool.query("select type, amount, round from public.credit_ledger where lead_id = $1 order by created_at, type", [lead]).then((r) => r.rows);

describe("S1: a settled reservation can't be used to write for free", () => {
  it("stop a run, start it again: the stopped leads are reserved and charged again", async () => {
    const c = await campaign(["s1@acmestudio.nl", "s2@acmestudio.nl"]);
    await reserveForRun(pool, { workspaceId: ws, leadIds: c.leads, perLead: 1 });
    expect((await stopRun(pool, ws, c.id)).released).toBe(2);
    const before = await balance();
    // The customer starts the run again ("Run stopped" leads come back).
    await pool.query("update public.campaigns set status = 'running' where id = $1", [c.id]);
    await pool.query("update public.leads set status = 'queued', status_detail = null where campaign_id = $1", [c.id]);
    const r = await reserveForRun(pool, { workspaceId: ws, leadIds: c.leads, perLead: 1 });
    expect(r).toMatchObject({ ok: true, reserved: 2, credits: 2 });
    for (const id of c.leads) expect((await processLead(id, deps())).outcome).toBe("done");
    expect(await balance()).toMatchObject({ available: before.available - 2, reserved: 0, spent: before.spent + 2 });
    expect((await rounds(c.leads[0])).map((x) => x.round)).toEqual([1, 1, 2, 2]);
  });

  it("a retried reservation reuses the open one: never reserved twice", async () => {
    const c = await campaign(["retry@acmestudio.nl"]);
    await reserveForRun(pool, { workspaceId: ws, leadIds: c.leads, perLead: 1 });
    const before = await balance();
    expect(await reserveForRun(pool, { workspaceId: ws, leadIds: c.leads, perLead: 1 })).toMatchObject({ reserved: 0, credits: 0 });
    expect((await pool.query("select public.reserve_credits($1, 1) ok", [c.leads[0]])).rows[0].ok).toBe(true);
    expect(await balance()).toEqual(before);
    expect((await rounds(c.leads[0])).filter((x) => x.type === "reserve")).toHaveLength(1);
  });

  it("capture never exceeds the open round, and settles nothing once it is closed", async () => {
    const c = await campaign(["cap@acmestudio.nl"]);
    await reserveForRun(pool, { workspaceId: ws, leadIds: c.leads, perLead: 1 });
    expect((await pool.query("select public.capture_credits($1, 5) n", [c.leads[0]])).rows[0].n).toBe(1);
    expect((await pool.query("select public.capture_credits($1, 1) n", [c.leads[0]])).rows[0].n).toBe(0);
    expect((await pool.query("select public.release_credits($1) n", [c.leads[0]])).rows[0].n).toBe(0);
    await expect(pool.query("insert into public.credit_ledger (workspace_id, type, amount, lead_id, round) values ($1, 'capture', 1, $2, 1)", [ws, c.leads[0]])).rejects.toThrow(/exceed/);
  });

  it("write anyway during a run: reserved and charged 1 credit (the skip had released the first reservation)", async () => {
    const c = await campaign(["fit@acmestudio.nl"], { fits: "packaging design", excludes: "food brands", strictness: "normal" });
    await reserveForRun(pool, { workspaceId: ws, leadIds: c.leads, perLead: 1 });
    expect((await processLead(c.leads[0], deps())).outcome).toBe("skipped"); // not a fit: released
    const before = await balance();
    expect(await writeAnyway(pool, { workspaceId: ws, leadId: c.leads[0], deepOn: false })).toEqual({ ok: true, enqueue: "run", credits: 1 });
    expect((await processLead(c.leads[0], deps(), { force: true })).outcome).toBe("done");
    expect(await balance()).toMatchObject({ available: before.available - 1, reserved: before.reserved, spent: before.spent + 1 });
  });
});

describe("S4: a lead that failed for good gets its credits back, and is charged when run again", () => {
  it("release on final failure, then a new reservation on the next run", async () => {
    const c = await campaign(["failed@acmestudio.nl"]);
    await reserveForRun(pool, { workspaceId: ws, leadIds: c.leads, perLead: 1 });
    const reserved = await balance();
    // What the worker does after the last retry: mark failed and settle at 0.
    await pool.query("update public.leads set status = 'failed' where id = $1", [c.leads[0]]);
    await new PgStore(pool).settleCredits(c.leads[0], 0);
    expect(await balance()).toMatchObject({ available: reserved.available + 1, reserved: reserved.reserved - 1 });
    expect(await reserveForRun(pool, { workspaceId: ws, leadIds: c.leads, perLead: 1 })).toMatchObject({ reserved: 1 });
    expect((await processLead(c.leads[0], deps(), { force: true })).outcome).toBe("done");
    expect((await balance()).reserved).toBe(reserved.reserved - 1);
  });
});

describe("S3: outgoing webhooks never reach internal addresses", () => {
  const dns = async (h: string) => ({ "hooks.example.com": ["93.184.216.34"], "inside.example.com": ["10.0.0.7"] })[h] ?? Promise.reject(new Error("ENOTFOUND"));

  it("saving: a name that resolves inside our network is refused", async () => {
    expect(await endpointHostProblem("https://hooks.example.com/x", { resolve: dns })).toBeNull();
    expect(await endpointHostProblem("https://inside.example.com/x", { resolve: dns })).toMatch(/public internet address/);
    expect(await endpointHostProblem("http://localhost:5678/x", { allowPrivate: true })).toBeNull(); // local development
  });

  it("delivering: a host that now resolves inside is refused before any request", async () => {
    const { row } = await createEndpoint(pool, KEY, ws, "https://inside.example.com/hook", ["job.completed"]);
    await pool.query("insert into public.webhook_deliveries (endpoint_id, workspace_id, event, event_id, payload) values ($1, $2, 'job.completed', 'job-1', '{}')", [row.id, ws]);
    const called: string[] = [];
    const r = await deliverDue(pool, KEY, async (url) => (called.push(url), { status: 200 }), new Date(), 50, (url) => isPublicUrlHost(url, dns));
    expect(called).toEqual([]);
    expect(r.delivered).toBe(0);
    const d = (await pool.query("select last_error from public.webhook_deliveries where endpoint_id = $1", [row.id])).rows[0];
    expect(d.last_error).toMatch(/private or internal network/);
  });
});
