// End to end for Smartlead and Lemlist, like push-e2e.test.ts for Instantly: real Postgres 17 (embedded),
// the same push and webhook code the app and worker run, and simulated tool APIs. Nothing reaches a real tool.
// Focus: what differs from Instantly. Smartlead: per-campaign webhooks, key in the query string, no idempotency
// key. Lemlist: one request per lead, 429 in the middle of a batch, new unsubscribe event types.
import EmbeddedPostgres from "embedded-postgres";
import { randomBytes } from "node:crypto";
import { mkdtempSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { connectTool, receiveWebhook } from "@/integrations/connect";
import { defaultVariableMap } from "@/integrations/fields";
import { RateLimiter } from "@/integrations/http";
import { LemlistTool } from "@/integrations/lemlist";
import { createPush, pollIntegrations, pushItems, runPush, type PushDeps, type ToolFactory } from "@/integrations/push-pg";
import { SmartleadTool } from "@/integrations/smartlead";
import { lemlistSim, lemlistWebhook } from "@/integrations/testing/lemlist-sim";
import { smartleadSim, smartleadWebhook } from "@/integrations/testing/smartlead-sim";

const root = path.resolve(__dirname, "..");
const USER = "00000000-0000-0000-0000-0000000000e3";
const KEY = randomBytes(32);
const APP = "https://firstline.example";
const fast = () => new RateLimiter(10_000, 1000);

let server: EmbeddedPostgres;
let pool: pg.Pool;
let dir: string;
let ws: string;
let campaignNo = 0;

beforeAll(async () => {
  dir = mkdtempSync(path.join(tmpdir(), "firstline-e2e-tools-"));
  const port = 44_000 + Math.floor(Math.random() * 3_000);
  server = new EmbeddedPostgres({ databaseDir: dir, user: "postgres", password: "test", port, persistent: false, onLog: () => {} });
  await server.initialise();
  await server.start();
  pool = new pg.Pool({ host: "127.0.0.1", port, user: "postgres", password: "test", database: "postgres", max: 10 });
  await pool.query(readFileSync(path.join(root, "tests/supabase-shim.sql"), "utf8"));
  for (const f of readdirSync(path.join(root, "migrations")).filter((f) => f.endsWith(".sql")).sort()) {
    await pool.query(readFileSync(path.join(root, "migrations", f), "utf8"));
  }
  await pool.query("insert into auth.users (id, email) values ($1, 'owner@tools.nl')", [USER]);
  ws = (await pool.query("select id from public.workspaces where owner_id = $1", [USER])).rows[0].id;
}, 120_000);

afterAll(async () => {
  await pool?.end();
  await server?.stop();
  rmSync(dir, { recursive: true, force: true });
});

async function writtenCampaign(n: number) {
  campaignNo++;
  const c = (await pool.query("insert into public.campaigns (workspace_id, name, writer) values ($1, $2, 'pro') returning id", [ws, `Tools ${campaignNo}`])).rows[0].id as string;
  const emails: string[] = [];
  for (let i = 0; i < n; i++) {
    const email = `p${i}.c${campaignNo}@shop${i}.nl`;
    const id = (
      await pool.query("insert into public.leads (workspace_id, campaign_id, email, first_name, company, domain, status) values ($1, $2, $3, 'Sanne', $4, $5, 'done') returning id", [
        ws,
        c,
        email,
        `Shop ${i}`,
        `shop${i}.nl`,
      ])
    ).rows[0].id;
    await pool.query(
      `insert into public.generations (lead_id, workspace_id, subject, full_email, slot_outputs, facts_used, research, skill_version, step_no)
       values ($1, $2, 'Idea', $3, $4, '{F1}', '{"facts":[{"id":"F1","tier":"B"}]}', '1.0', 1)`,
      [id, ws, `Hi Sanne,\n\nOpener ${i}.\n\nBest`, JSON.stringify({ opener: `Opener ${i}` })],
    );
    emails.push(email);
  }
  return { id: c, emails };
}

const map = defaultVariableMap(["opener"], []);
const tokenOf = (url: string) => {
  const m = new URL(url).pathname.match(/^\/api\/integrations\/webhook\/([^/]+)\/([^/]+)$/)!;
  return { integrationId: m[1], token: m[2] };
};

describe("Smartlead, end to end", () => {
  const sim = smartleadSim({ blocklist: [] });
  const toolFor: ToolFactory = (_p, k) => new SmartleadTool(k, sim.fetch, { limiter: fast() });
  const deps: PushDeps = { key: KEY, toolFor, publicUrl: APP, sleep: async () => {} };
  let integrationId = "";
  let camp: { id: string; emails: string[] };

  it("connects; webhooks are promised per campaign, nothing account-wide is created", async () => {
    const r = await connectTool(pool, KEY, { workspaceId: ws, provider: "smartlead", apiKey: sim.key, publicUrl: APP, toolFor });
    expect(r).toMatchObject({ ok: true, webhooks: true });
    integrationId = (r as { integrationId: string }).integrationId;
    expect(sim.state.webhooks).toEqual([]);
    expect(sim.state.requests.every((q) => q.path !== "/webhook/create")).toBe(true);
    const bad = await connectTool(pool, KEY, { workspaceId: ws, provider: "smartlead", apiKey: "wrong-key-123", publicUrl: APP, toolFor });
    expect(bad).toEqual({ error: "Smartlead rejected the API key. Copy it again from Smartlead → Settings → API Keys." });
  });

  it("the first push adds our webhook to that Smartlead campaign, then pushes with custom_fields", async () => {
    camp = await writtenCampaign(6);
    const p = await createPush(pool, { workspaceId: ws, campaignId: camp.id, integrationId, toolCampaignId: "3001", toolCampaignName: "Bakeries Utrecht", variableMap: map, kind: "full", userId: USER });
    if ("error" in p) throw new Error(p.error);
    expect(await runPush(pool, p.push.id, deps)).toMatchObject({ status: "done", added: 6 });
    expect(sim.state.webhooks).toHaveLength(1);
    expect(sim.state.webhooks[0]).toMatchObject({ email_campaign_id: 3001 });
    expect(sim.state.webhooks[0].webhook_url.startsWith(`${APP}/api/integrations/webhook/${integrationId}/`)).toBe(true);
    expect(sim.state.leads[0].custom_fields).toMatchObject({ fl_opener: "Opener 0", fl_full_email: "Hi Sanne,\n\nOpener 0.\n\nBest" });
    const { rows } = await pool.query("select hooked_campaigns from public.integrations where id = $1", [integrationId]);
    expect(rows[0].hooked_campaigns).toEqual(["3001"]);
  });

  it("a second push to the same campaign doesn't add another webhook", async () => {
    const c2 = await writtenCampaign(2);
    const p = await createPush(pool, { workspaceId: ws, campaignId: c2.id, integrationId, toolCampaignId: "3001", toolCampaignName: null, variableMap: map, kind: "full", userId: USER });
    if ("error" in p) throw new Error(p.error);
    await runPush(pool, p.push.id, deps);
    expect(sim.state.webhooks).toHaveLength(1);
  });

  it("after a crash mid-call, the retry's 'already in campaign' answers count as added, not skipped", async () => {
    const c3 = await writtenCampaign(4);
    const p = await createPush(pool, { workspaceId: ws, campaignId: c3.id, integrationId, toolCampaignId: "3002", toolCampaignName: null, variableMap: map, kind: "full", userId: USER });
    if ("error" in p) throw new Error(p.error);
    let crash = true;
    const crashing: ToolFactory = (pv, k) => {
      const t = toolFor(pv, k) as SmartleadTool;
      const real = t.pushLeads.bind(t);
      t.pushLeads = async (...a) => {
        const r = await real(...a);
        if (crash) {
          crash = false;
          throw new Error("worker crashed after Smartlead took the leads");
        }
        return r;
      };
      return t;
    };
    expect((await runPush(pool, p.push.id, { ...deps, toolFor: crashing }))?.status).toBe("failed");
    const { retryFailed } = await import("@/integrations/push-pg");
    expect(await retryFailed(pool, ws, p.push.id)).toBe(4);
    const r = await runPush(pool, p.push.id, deps);
    expect(r).toMatchObject({ status: "done", added: 4, skipped: 0 });
    expect(sim.state.leads.filter((l) => l.campaign === "3002")).toHaveLength(4);
  });

  it("Smartlead calls our webhook: reply, bounce, unsubscribe are applied once, reply text never stored", async () => {
    const { integrationId: id, token } = tokenOf(sim.state.webhooks[0].webhook_url);
    const send = (body: unknown) => receiveWebhook(pool, KEY, { integrationId: id, token, body: JSON.stringify(body), toolFor });
    expect((await send(smartleadWebhook("EMAIL_REPLY", camp.emails[0], 3001, { reply_body: "Call me Tuesday", preview_text: "Call me" }))).body).toMatchObject({ applied: 1 });
    expect((await send(smartleadWebhook("EMAIL_REPLY", camp.emails[0], 3001, { reply_body: "Call me Tuesday" }))).body).toMatchObject({ duplicate: 1 });
    await send(smartleadWebhook("EMAIL_BOUNCE", camp.emails[1], 3001));
    await send(smartleadWebhook("LEAD_UNSUBSCRIBED", camp.emails[2], 3001));
    const items = await pushItems(pool, ws, (await pool.query("select id from public.pushes where campaign_id = $1", [camp.id])).rows[0].id);
    expect(items.find((i) => i.email === camp.emails[0])).toMatchObject({ replied: true });
    expect(items.find((i) => i.email === camp.emails[1])).toMatchObject({ bounced: true });
    expect(items.find((i) => i.email === camp.emails[2])).toMatchObject({ unsubscribed: true });
    const { rows } = await pool.query("select email, reason from public.suppression where workspace_id = $1 and email = any($2) order by reason", [ws, camp.emails]);
    expect(rows).toEqual([
      { email: camp.emails[1], reason: "bounce" },
      { email: camp.emails[2], reason: "unsub" },
    ]);
    const dump = JSON.stringify((await pool.query("select * from public.integration_events")).rows);
    expect(dump).not.toMatch(/Tuesday|shop\d/);
  });

  it("the API key never appears in stored errors, and a campaign whose webhook couldn't be added is polled", async () => {
    // A tool campaign where Smartlead refuses our webhook: the push still works, and polling covers it.
    const refusing = smartleadSim({ webhooksForbidden: true, key: sim.key });
    const tf: ToolFactory = (_p, k) => new SmartleadTool(k, refusing.fetch, { limiter: fast() });
    const c4 = await writtenCampaign(2);
    const p = await createPush(pool, { workspaceId: ws, campaignId: c4.id, integrationId, toolCampaignId: "3003", toolCampaignName: null, variableMap: map, kind: "full", userId: USER });
    if ("error" in p) throw new Error(p.error);
    expect(await runPush(pool, p.push.id, { ...deps, toolFor: tf })).toMatchObject({ status: "done", added: 2 });
    const { rows } = await pool.query("select last_error, hooked_campaigns from public.integrations where id = $1", [integrationId]);
    expect(rows[0].last_error).toMatch(/Statuses are checked every 15 minutes/);
    expect(rows[0].last_error).not.toContain(sim.key);
    expect(rows[0].hooked_campaigns).toEqual(["3001", "3002"]);

    refusing.state.leads.find((l) => l.email === c4.emails[0])!.replied = true;
    await pool.query("update public.integrations set last_polled_at = null where id = $1", [integrationId]);
    const polled = await pollIntegrations(pool, { ...deps, toolFor: tf });
    expect(polled).toMatchObject({ polled: 1, applied: 1 });
    // Only the unhooked campaign is polled.
    const polledPaths = refusing.state.requests.filter((q) => q.method === "GET" && q.path.endsWith("/leads")).map((q) => q.path);
    expect(new Set(polledPaths)).toEqual(new Set(["/campaigns/3003/leads"]));
  });
});

describe("Lemlist, end to end", () => {
  const sim = lemlistSim({ rateLimitAt: 3 });
  const toolFor: ToolFactory = (_p, k) => new LemlistTool(k, sim.fetch, { limiter: fast(), sleep: async () => {} });
  const deps: PushDeps = { key: KEY, toolFor, publicUrl: APP, sleep: async () => {} };
  let camp: { id: string; emails: string[] };
  let integrationId = "";

  it("connects with Basic auth and registers 6 hooks, one URL each", async () => {
    const r = await connectTool(pool, KEY, { workspaceId: ws, provider: "lemlist", apiKey: sim.key, publicUrl: APP, toolFor });
    expect(r).toMatchObject({ ok: true, webhooks: true, note: null });
    integrationId = (r as { integrationId: string }).integrationId;
    expect(sim.state.hooks).toHaveLength(6);
    expect(sim.state.hooks.every((h) => h.targetUrl.startsWith(`${APP}/api/integrations/webhook/${integrationId}/`))).toBe(true);
  });

  it("pushes lead by lead, waits out a 429 in the middle, and every lead lands once", async () => {
    camp = await writtenCampaign(7);
    const p = await createPush(pool, { workspaceId: ws, campaignId: camp.id, integrationId, toolCampaignId: "cam_A1", toolCampaignName: "Bakeries Utrecht", variableMap: map, kind: "full", userId: USER });
    if ("error" in p) throw new Error(p.error);
    expect(await runPush(pool, p.push.id, deps)).toMatchObject({ status: "done", added: 7, failed: 0 });
    expect(sim.state.leads.map((l) => l.email).sort()).toEqual([...camp.emails].sort());
    expect(sim.state.leads[0].vars).toEqual({ fl_subject: "Idea", fl_opener: "Opener 0", fl_full_email: "Hi Sanne,\n\nOpener 0.\n\nBest" });
  });

  it("Lemlist calls our webhook, including the new unsubscribe event; third-party replies are ignored", async () => {
    const send = (type: string, email: string, extra: Record<string, unknown> = {}) => {
      const hook = sim.state.hooks.find((h) => h.type === type)!;
      const { integrationId: id, token } = tokenOf(hook.targetUrl);
      return receiveWebhook(pool, KEY, { integrationId: id, token, body: JSON.stringify(lemlistWebhook(type, email, "cam_A1", extra)), toolFor });
    };
    expect((await send("emailsSent", camp.emails[0])).body).toMatchObject({ applied: 1 });
    expect((await send("emailsReplied", camp.emails[0])).body).toMatchObject({ applied: 1 });
    expect((await send("emailsBounced", camp.emails[1])).body).toMatchObject({ applied: 1 });
    expect((await send("entityUnsubscribed", camp.emails[2])).body).toMatchObject({ applied: 1 });
    expect((await send("emailsReplied", "someone@else.nl", { isThirdPartyReply: true })).body).toMatchObject({ applied: 0, unmatched: 0 });
    const { rows } = await pool.query(
      "select l.email, o.status from public.outcomes o join public.leads l on l.id = o.lead_id where o.campaign_id = $1 and o.channel = 'lemlist' and o.status <> 'pushed' order by l.email",
      [camp.id],
    );
    expect(rows.map((r) => r.status).sort()).toEqual(["bounced", "replied", "unsubscribed"]);
  });

  it("disconnecting removes the 6 hooks from Lemlist", async () => {
    const { integrationSecret, disconnectIntegration } = await import("@/integrations/push-pg");
    const s = await integrationSecret(pool, KEY, integrationId);
    await toolFor("lemlist", s!.apiKey).removeWebhooks(s!.row.tool_webhook_ids);
    await disconnectIntegration(pool, ws, integrationId);
    expect(sim.state.hooks).toEqual([]);
    expect(await integrationSecret(pool, KEY, integrationId)).toBeNull();
  });
});
