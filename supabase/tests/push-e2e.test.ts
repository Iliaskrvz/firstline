// End to end, in place of the manual Instantly test: the same steps a user takes, through the same
// code the app and worker run, against a real Postgres 17 (embedded) and a simulated Instantly API v2
// that also "calls" our webhook URL like Instantly would. Nothing reaches the real Instantly.
//
// connect (bad key, unpaid plan, good key) → webhooks registered → dry run (5) → full push →
// Instantly sends sent / reply / bounce / unsubscribe events (plus retries and forgeries) →
// flags, suppression, outcome rows → reconnect → a plan without webhooks falls back to polling.
import EmbeddedPostgres from "embedded-postgres";
import { randomBytes } from "node:crypto";
import { mkdtempSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { connectTool, receiveWebhook } from "@/integrations/connect";
import { defaultVariableMap } from "@/integrations/fields";
import { InstantlyTool } from "@/integrations/instantly";
import { createPush, pollIntegrations, pushItems, runPush, type PushDeps, type ToolFactory } from "@/integrations/push-pg";
import { instantlySim, instantlyWebhook } from "@/integrations/testing/instantly-sim";

const root = path.resolve(__dirname, "..");
const USER = "00000000-0000-0000-0000-0000000000e2";
const KEY = randomBytes(32);
const APP = "https://firstline.example";

let server: EmbeddedPostgres;
let pool: pg.Pool;
let dir: string;
let ws: string;

beforeAll(async () => {
  dir = mkdtempSync(path.join(tmpdir(), "firstline-e2e-"));
  const port = 48_000 + Math.floor(Math.random() * 3_000);
  server = new EmbeddedPostgres({ databaseDir: dir, user: "postgres", password: "test", port, persistent: false, onLog: () => {} });
  await server.initialise();
  await server.start();
  pool = new pg.Pool({ host: "127.0.0.1", port, user: "postgres", password: "test", database: "postgres", max: 10 });
  await pool.query(readFileSync(path.join(root, "tests/supabase-shim.sql"), "utf8"));
  for (const f of readdirSync(path.join(root, "migrations")).filter((f) => f.endsWith(".sql")).sort()) {
    await pool.query(readFileSync(path.join(root, "migrations", f), "utf8"));
  }
  await pool.query("insert into auth.users (id, email) values ($1, 'owner@agency.nl')", [USER]);
  ws = (await pool.query("select id from public.workspaces where owner_id = $1", [USER])).rows[0].id;
}, 120_000);

afterAll(async () => {
  await pool?.end();
  await server?.stop();
  rmSync(dir, { recursive: true, force: true });
});

/** A campaign as the engine leaves it: written leads (personalised or fallback), one failed lead. */
async function writtenCampaign(emails: string[]) {
  const c = (await pool.query("insert into public.campaigns (workspace_id, name, writer) values ($1, 'Bakeries Utrecht', 'pro') returning id", [ws])).rows[0].id as string;
  const leads: string[] = [];
  for (const [i, email] of emails.entries()) {
    const status = email.startsWith("broken") ? "failed" : i === 6 ? "fallback" : "done";
    const id = (
      await pool.query(
        "insert into public.leads (workspace_id, campaign_id, email, first_name, last_name, company, title, website, domain, status) values ($1, $2, $3, $4, 'de Vries', $5, 'Owner', $6, $6, $7) returning id",
        [ws, c, email, `Name${i}`, `Bakery ${i}`, email.split("@")[1], status],
      )
    ).rows[0].id as string;
    if (status !== "failed") {
      await pool.query(
        `insert into public.generations (lead_id, workspace_id, subject, full_email, slot_outputs, facts_used, research, skill_version, step_no)
         values ($1, $2, $3, $4, $5, $6, $7, '1.0', 1)`,
        [
          id,
          ws,
          `Idea for Bakery ${i}`,
          `Hi Name${i},\n\n${status === "done" ? `Saw Bakery ${i} opened a second shop.` : "Hope the week is going well."}\n\nBest, Tom`,
          JSON.stringify({ opener: status === "done" ? `Saw Bakery ${i} opened a second shop.` : "Hope the week is going well." }),
          status === "done" ? ["F1"] : [],
          JSON.stringify({ facts: [{ id: "F1", tier: "A", text: "Second shop", src: "https://x/nieuws" }] }),
        ],
      );
    }
    leads.push(id);
  }
  return { id: c, leads };
}

/** Deliver one event to every webhook URL Instantly has for that event type, the way Instantly would. */
async function instantlyCalls(sim: ReturnType<typeof instantlySim>, toolFor: ToolFactory, body: Record<string, unknown>) {
  const out: { status: number; body: Record<string, unknown> }[] = [];
  for (const w of sim.state.webhooks.filter((x) => x.event_type === body.event_type || x.event_type === "all_events")) {
    const m = new URL(w.target_hook_url).pathname.match(/^\/api\/integrations\/webhook\/([^/]+)\/([^/]+)$/);
    expect(m, "webhook URL points at our route").not.toBeNull();
    out.push(await receiveWebhook(pool, KEY, { integrationId: m![1], token: m![2], body: JSON.stringify(body), toolFor }));
  }
  return out;
}

describe("Instantly, end to end (simulated API, real database, real push and webhook code)", () => {
  const sim = instantlySim({ blocklist: ["blocked@bakery4.nl"] });
  const toolFor: ToolFactory = (_p, k) => new InstantlyTool(k, sim.fetch);
  const sleeps: number[] = [];
  const deps: PushDeps = { key: KEY, toolFor, sleep: async (ms) => void sleeps.push(ms) };
  const instantlyCampaign = sim.state.campaigns[0].id;
  let integrationId = "";
  let camp: { id: string; leads: string[] };
  const emails = ["anna@bakery0.nl", "bram@bakery1.nl", "cees@bakery2.nl", "dirk@bakery3.nl", "blocked@bakery4.nl", "eva@bakery5.nl", "fien@bakery6.nl", "gijs@bakery7.nl", "broken@bakery8.nl", "suppressed@bakery9.nl"];

  it("1. Integrations page: a wrong key and an unpaid plan get a clear message; nothing is saved", async () => {
    const bad = await connectTool(pool, KEY, { workspaceId: ws, provider: "instantly", apiKey: "wrong-key-123", publicUrl: APP, toolFor });
    expect(bad).toEqual({ error: "Instantly rejected the API key. Check that it is an API v2 key and not revoked." });
    const unpaidSim = instantlySim({ plan: "unpaid" });
    const unpaid = await connectTool(pool, KEY, { workspaceId: ws, provider: "instantly", apiKey: "test-key", publicUrl: APP, toolFor: (_p, k) => new InstantlyTool(k, unpaidSim.fetch) });
    expect(unpaid).toEqual({ error: "Your Instantly workspace has no active paid plan that includes the API." });
    expect((await pool.query("select count(*)::int n from public.integrations where workspace_id = $1", [ws])).rows[0].n).toBe(0);
  });

  it("2. A good key is saved encrypted and Instantly gets our webhook for 4 events", async () => {
    const r = await connectTool(pool, KEY, { workspaceId: ws, provider: "instantly", apiKey: "test-key", publicUrl: APP, toolFor });
    expect(r).toMatchObject({ ok: true, webhooks: true, note: null });
    integrationId = (r as { integrationId: string }).integrationId;
    expect(sim.state.webhooks.map((w) => w.event_type)).toEqual(["email_sent", "reply_received", "email_bounced", "lead_unsubscribed"]);
    expect(sim.state.webhooks.every((w) => w.target_hook_url.startsWith(`${APP}/api/integrations/webhook/${integrationId}/`))).toBe(true);
    const { rows } = await pool.query("select api_key_encrypted, key_hint, account_name, capabilities from public.integrations where id = $1", [integrationId]);
    expect(rows[0]).toMatchObject({ key_hint: "-key", account_name: "Acme Outreach", capabilities: { webhooks: true } });
    expect(rows[0].api_key_encrypted).not.toContain("test-key");
  });

  it("3. Dry run: the first 5 written leads land in Instantly with the personalised parts as variables", async () => {
    camp = await writtenCampaign(emails);
    await pool.query("insert into public.suppression (workspace_id, email, reason) values ($1, 'suppressed@bakery9.nl', 'manual')", [ws]);
    const map = defaultVariableMap(["opener"], []);
    const r = await createPush(pool, { workspaceId: ws, campaignId: camp.id, integrationId, toolCampaignId: instantlyCampaign, toolCampaignName: "Q4 outreach", variableMap: map, kind: "dry_run", userId: USER });
    if ("error" in r) throw new Error(r.error);
    const done = await runPush(pool, r.push.id, deps);
    // blocked@bakery4.nl is on the Instantly blocklist: Instantly skips it and says why.
    expect(done).toMatchObject({ status: "done", total: 5, added: 4, skipped: 1, failed: 0 });
    expect((await pushItems(pool, ws, r.push.id)).find((i) => i.email === "blocked@bakery4.nl")?.reason).toBe("Skipped by Instantly: on your Instantly blocklist");

    expect(sim.state.variables.get(instantlyCampaign)).toEqual(["fl_subject", "fl_opener", "fl_full_email"]);
    const anna = sim.state.leads.find((l) => l.email === "anna@bakery0.nl")!;
    expect(anna.custom_variables).toEqual({
      fl_subject: "Idea for Bakery 0",
      fl_opener: "Saw Bakery 0 opened a second shop.",
      fl_full_email: "Hi Name0,\n\nSaw Bakery 0 opened a second shop.\n\nBest, Tom",
    });
    const add = sim.state.requests.find((q) => q.path === "/leads/add")!.body as { leads: Record<string, unknown>[] };
    expect(add.leads[0]).toMatchObject({ email: "anna@bakery0.nl", first_name: "Name0", last_name: "de Vries", company_name: "Bakery 0", job_title: "Owner", website: "bakery0.nl" });
  });

  it("4. Push all: the rest goes in; already-pushed, suppressed and failed leads don't", async () => {
    const r = await createPush(pool, { workspaceId: ws, campaignId: camp.id, integrationId, toolCampaignId: instantlyCampaign, toolCampaignName: "Q4 outreach", variableMap: defaultVariableMap(["opener"], []), kind: "full", userId: USER });
    if ("error" in r) throw new Error(r.error);
    const done = await runPush(pool, r.push.id, deps);
    // 9 written leads: 4 already added, 1 suppressed → skipped right away; blocked one Instantly skips again; 3 new.
    expect(done).toMatchObject({ status: "done", total: 9, added: 3, skipped: 6, failed: 0 });
    expect(sim.state.leads.map((l) => l.email).sort()).toEqual(["anna@bakery0.nl", "bram@bakery1.nl", "cees@bakery2.nl", "dirk@bakery3.nl", "eva@bakery5.nl", "fien@bakery6.nl", "gijs@bakery7.nl"]);
    expect(sim.state.leads.some((l) => l.email === "broken@bakery8.nl" || l.email === "suppressed@bakery9.nl")).toBe(false);
    const { rows } = await pool.query("select status, personalised from public.outcomes where campaign_id = $1 and channel = 'instantly'", [camp.id]);
    expect(rows).toHaveLength(7);
    expect(rows.filter((x) => !x.personalised)).toHaveLength(1); // fien: the neutral fallback
  });

  it("5. Instantly calls our webhook: sent, reply, bounce, unsubscribe; retries and forgeries change nothing", async () => {
    for (const e of ["anna@bakery0.nl", "bram@bakery1.nl", "cees@bakery2.nl"]) {
      expect((await instantlyCalls(sim, toolFor, instantlyWebhook("email_sent", e, instantlyCampaign)))[0]).toMatchObject({ status: 200, body: { applied: 1 } });
    }
    const reply = instantlyWebhook("reply_received", "anna@bakery0.nl", instantlyCampaign, { reply_text: "Sounds good, call me Tuesday", reply_html: "<p>Sounds good</p>", reply_subject: "Re: Idea" });
    expect((await instantlyCalls(sim, toolFor, reply))[0].body).toMatchObject({ applied: 1 });
    expect((await instantlyCalls(sim, toolFor, reply))[0].body).toMatchObject({ applied: 0, duplicate: 1 }); // Instantly retries
    await instantlyCalls(sim, toolFor, instantlyWebhook("email_bounced", "bram@bakery1.nl", instantlyCampaign));
    await instantlyCalls(sim, toolFor, instantlyWebhook("lead_unsubscribed", "cees@bakery2.nl", instantlyCampaign));
    // A lead that isn't ours (someone else's campaign in the same Instantly workspace) is ignored.
    expect((await instantlyCalls(sim, toolFor, instantlyWebhook("reply_received", "stranger@else.nl", instantlyCampaign)))[0].body).toMatchObject({ unmatched: 1 });

    const token = new URL(sim.state.webhooks[0].target_hook_url).pathname.split("/").pop()!;
    expect(await receiveWebhook(pool, KEY, { integrationId, token: "x".repeat(32), body: JSON.stringify(reply), toolFor })).toMatchObject({ status: 404 });
    expect(await receiveWebhook(pool, KEY, { integrationId: "00000000-0000-0000-0000-000000000000", token, body: "{}", toolFor })).toMatchObject({ status: 404 });
    expect(await receiveWebhook(pool, KEY, { integrationId, token, body: "not json", toolFor })).toMatchObject({ status: 400 });

    const items = await pushItems(pool, ws, (await pool.query("select id from public.pushes where campaign_id = $1 and kind = 'dry_run'", [camp.id])).rows[0].id);
    expect(items.find((i) => i.email === "anna@bakery0.nl")).toMatchObject({ replied: true });
    expect(items.find((i) => i.email === "bram@bakery1.nl")).toMatchObject({ bounced: true });
    expect(items.find((i) => i.email === "cees@bakery2.nl")).toMatchObject({ unsubscribed: true });
    const { rows: sup } = await pool.query("select email, reason from public.suppression where workspace_id = $1 and email like '%bakery%' order by email", [ws]);
    expect(sup).toEqual([
      { email: "bram@bakery1.nl", reason: "bounce" },
      { email: "cees@bakery2.nl", reason: "unsub" },
      { email: "suppressed@bakery9.nl", reason: "manual" },
    ]);
    const { rows: oc } = await pool.query(
      "select l.email, o.status from public.outcomes o join public.leads l on l.id = o.lead_id where o.campaign_id = $1 and o.status <> 'pushed' order by l.email",
      [camp.id],
    );
    expect(oc).toEqual([
      { email: "anna@bakery0.nl", status: "replied" },
      { email: "bram@bakery1.nl", status: "bounced" },
      { email: "cees@bakery2.nl", status: "unsubscribed" },
    ]);
    // Nothing personal or from the reply is stored with the events.
    const dump = JSON.stringify((await pool.query("select * from public.integration_events")).rows) + JSON.stringify((await pool.query("select * from public.outcomes")).rows);
    expect(dump).not.toMatch(/bakery|stranger|Sounds good|Tuesday/);
  });

  it("6. Reconnecting with a new key removes the old webhooks in Instantly first", async () => {
    const before = sim.state.webhooks.map((w) => w.id);
    const oldToken = new URL(sim.state.webhooks[0].target_hook_url).pathname.split("/").pop()!;
    const r = await connectTool(pool, KEY, { workspaceId: ws, provider: "instantly", apiKey: "test-key", publicUrl: APP, toolFor });
    expect(r).toMatchObject({ ok: true, webhooks: true });
    expect(sim.state.webhooks).toHaveLength(4);
    expect(sim.state.webhooks.some((w) => before.includes(w.id))).toBe(false);
    // The old URL token no longer works; the new one does.
    const newId = (r as { integrationId: string }).integrationId;
    expect(await receiveWebhook(pool, KEY, { integrationId: newId, token: oldToken, body: "{}", toolFor })).toMatchObject({ status: 404 });
    const res = await instantlyCalls(sim, toolFor, instantlyWebhook("email_sent", "dirk@bakery3.nl", instantlyCampaign));
    expect(res[0]).toMatchObject({ status: 200, body: { applied: 1 } });
  });

  it("7. A plan without webhooks: connect says so, and the worker's 15-minute check picks up replies", async () => {
    const noHooks = instantlySim({ plan: "no-webhooks" });
    const tf: ToolFactory = (_p, k) => new InstantlyTool(k, noHooks.fetch);
    await pool.query("delete from public.integrations where workspace_id = $1", [ws]);
    const r = await connectTool(pool, KEY, { workspaceId: ws, provider: "instantly", apiKey: "test-key", publicUrl: APP, toolFor: tf });
    expect(r).toMatchObject({ ok: true, webhooks: false });
    expect((r as { note: string }).note).toMatch(/plan doesn't include webhooks.*every 15 minutes/);
    const id = (r as { integrationId: string }).integrationId;

    const c = await writtenCampaign(["h@poll1.nl", "i@poll2.nl", "j@poll3.nl"]);
    const p = await createPush(pool, { workspaceId: ws, campaignId: c.id, integrationId: id, toolCampaignId: noHooks.state.campaigns[1].id, toolCampaignName: null, variableMap: defaultVariableMap(["opener"], []), kind: "full", userId: USER });
    if ("error" in p) throw new Error(p.error);
    expect(await runPush(pool, p.push.id, { ...deps, toolFor: tf })).toMatchObject({ status: "done", added: 3 });

    noHooks.state.leads.find((l) => l.email === "h@poll1.nl")!.timestamp_last_reply = "2026-11-13T08:00:00.000Z";
    noHooks.state.leads.find((l) => l.email === "i@poll2.nl")!.status = -1;
    const polled = await pollIntegrations(pool, { ...deps, toolFor: tf });
    expect(polled.polled).toBe(1);
    const items = await pushItems(pool, ws, p.push.id);
    expect(items.find((i) => i.email === "h@poll1.nl")).toMatchObject({ replied: true });
    expect(items.find((i) => i.email === "i@poll2.nl")).toMatchObject({ bounced: true });
    expect(items.find((i) => i.email === "j@poll3.nl")).toMatchObject({ replied: false, bounced: false });
  });
});
