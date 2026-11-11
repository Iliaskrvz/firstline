// Integration: pushing to sending tools on a real Postgres 17 (embedded) with the fake tool and
// the simulated Instantly API: dry run, full push, retries, crash resume, retry failed,
// webhook/poll events exactly once, suppression, outcome rows without personal data.
import EmbeddedPostgres from "embedded-postgres";
import { randomBytes } from "node:crypto";
import { mkdtempSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { FakeTool } from "@/integrations/fake";
import { defaultVariableMap } from "@/integrations/fields";
import { InstantlyTool } from "@/integrations/instantly";
import {
  applyToolEvents,
  claimPush,
  createPush,
  integrationSecret,
  pollIntegrations,
  pushesToResume,
  pushItems,
  retryFailed,
  runPush,
  saveIntegration,
  setCapabilities,
  type PushDeps,
  type PushRow,
} from "@/integrations/push-pg";
import { instantlySim } from "@/integrations/testing/instantly-sim";
import { ToolError, type SendingTool } from "@/integrations/types";

const root = path.resolve(__dirname, "..");
const USER = "00000000-0000-0000-0000-0000000000f7";
const KEY = randomBytes(32);

let server: EmbeddedPostgres;
let pool: pg.Pool;
let dir: string;
let ws: string;

let campaignNo = 0;
async function campaign(n: number, emails?: string[]) {
  campaignNo++;
  const c = (await pool.query("insert into public.campaigns (workspace_id, name, writer) values ($1, 'Push test', 'pro') returning id", [ws])).rows[0].id as string;
  const list = emails ?? Array.from({ length: n }, (_, i) => `lead${i + 1}.c${campaignNo}@shop${i + 1}.nl`);
  const ids: string[] = [];
  for (const [i, email] of list.entries()) {
    const status = email.startsWith("failed") ? "failed" : i % 7 === 6 ? "fallback" : "done";
    const id = (
      await pool.query(
        "insert into public.leads (workspace_id, campaign_id, email, first_name, company, domain, status) values ($1, $2, $3, 'Sanne', 'Shop BV', split_part($3, '@', 2), $4) returning id",
        [ws, c, email, status],
      )
    ).rows[0].id as string;
    await pool.query(
      `insert into public.generations (lead_id, workspace_id, subject, full_email, slot_outputs, facts_used, research, skill_version, step_no)
       values ($1, $2, 'Idea for you', $3, $4, '{F1,F2}', $5, '1.0', 1)`,
      [id, ws, `Hi Sanne,\n\nFull email ${i}.`, JSON.stringify({ opener: `Opener ${i}` }), JSON.stringify({ facts: [{ id: "F1", tier: "A" }, { id: "F2", tier: "B" }, { id: "F3", tier: "C" }] })],
    );
    ids.push(id);
  }
  return { id: c, leads: ids };
}

async function connect(tool: SendingTool, opts: { webhooks?: boolean } = {}) {
  const id = await saveIntegration(pool, KEY, { workspaceId: ws, provider: "instantly", apiKey: "the-real-key", keyHint: "-key", accountName: "Acme", webhookToken: "tok" });
  await setCapabilities(pool, id, { webhooks: opts.webhooks ?? true }, []);
  const sleeps: number[] = [];
  const deps: PushDeps = { key: KEY, toolFor: () => tool, sleep: async (ms) => void sleeps.push(ms) };
  return { id, deps, sleeps };
}

const map = defaultVariableMap(["opener"], []);
const asPush = (r: { push: PushRow } | { error: string }) => {
  if ("error" in r) throw new Error(r.error);
  return r.push;
};

beforeAll(async () => {
  dir = mkdtempSync(path.join(tmpdir(), "firstline-push-"));
  const port = 56_000 + Math.floor(Math.random() * 4_000);
  server = new EmbeddedPostgres({ databaseDir: dir, user: "postgres", password: "test", port, persistent: false, onLog: () => {} });
  await server.initialise();
  await server.start();
  pool = new pg.Pool({ host: "127.0.0.1", port, user: "postgres", password: "test", database: "postgres", max: 10 });
  await pool.query(readFileSync(path.join(root, "tests/supabase-shim.sql"), "utf8"));
  for (const f of readdirSync(path.join(root, "migrations")).filter((f) => f.endsWith(".sql")).sort()) {
    await pool.query(readFileSync(path.join(root, "migrations", f), "utf8"));
  }
  await pool.query("insert into auth.users (id, email) values ($1, 'me@pusher.nl')", [USER]);
  ws = (await pool.query("select id from public.workspaces where owner_id = $1", [USER])).rows[0].id;
}, 120_000);

afterAll(async () => {
  await pool?.end();
  await server?.stop();
  rmSync(dir, { recursive: true, force: true });
});

describe("push to a sending tool", () => {
  it("stores the API key and webhook token encrypted only", async () => {
    const { id } = await connect(new FakeTool());
    const { rows } = await pool.query("select api_key_encrypted, webhook_secret, key_hint from public.integrations where id = $1", [id]);
    expect(rows[0].api_key_encrypted).toMatch(/^v1:/);
    expect(rows[0].api_key_encrypted).not.toContain("the-real-key");
    expect(rows[0].webhook_secret).not.toBe("tok");
    const s = await integrationSecret(pool, KEY, id);
    expect(s?.apiKey).toBe("the-real-key");
    expect(s?.webhookToken).toBe("tok");
  });

  it("dry run pushes the first 5 written leads with their variables, then the full push does the rest", async () => {
    const tool = new FakeTool();
    const { id, deps } = await connect(tool);
    const camp = await campaign(12, [...Array.from({ length: 11 }, (_, i) => `lead${i + 1}@shop${i + 1}.nl`), "failed@x.nl"]);
    await pool.query("insert into public.suppression (workspace_id, email, reason) values ($1, 'lead11@shop11.nl', 'manual')", [ws]);

    const dry = asPush(await createPush(pool, { workspaceId: ws, campaignId: camp.id, integrationId: id, toolCampaignId: "fake-camp-1", toolCampaignName: "Q4", variableMap: map, kind: "dry_run", userId: USER }));
    expect(dry.total).toBe(5);
    const done = await runPush(pool, dry.id, deps);
    expect(done).toMatchObject({ status: "done", added: 5, skipped: 0, failed: 0 });
    expect([...tool.variables.get("fake-camp-1")!]).toEqual(["fl_subject", "fl_opener", "fl_full_email"]);
    const first = tool.leads.get("fake-camp-1")!.get("lead1@shop1.nl")!;
    expect(first.variables).toEqual({ fl_subject: "Idea for you", fl_opener: "Opener 0", fl_full_email: "Hi Sanne,\n\nFull email 0." });
    expect(first.company).toBe("Shop BV");

    const full = asPush(await createPush(pool, { workspaceId: ws, campaignId: camp.id, integrationId: id, toolCampaignId: "fake-camp-1", toolCampaignName: "Q4", variableMap: map, kind: "full", userId: USER }));
    const r = await runPush(pool, full.id, deps);
    // 11 written leads: 5 already added (skipped), 1 suppressed (skipped), 5 new. The failed lead is never pushed.
    expect(r).toMatchObject({ status: "done", added: 5, skipped: 6, failed: 0, total: 11 });
    const items = await pushItems(pool, ws, full.id);
    expect(items.find((i) => i.email === "lead11@shop11.nl")?.reason).toBe("On your suppression list");
    expect(items.filter((i) => i.reason === "Already pushed to this campaign")).toHaveLength(5);
    expect(tool.leads.get("fake-camp-1")!.size).toBe(10);

    expect("error" in (await createPush(pool, { workspaceId: ws, campaignId: camp.id, integrationId: id, toolCampaignId: "fake-camp-1", toolCampaignName: null, variableMap: map, kind: "dry_run", userId: USER }))).toBe(true);
  });

  it("writes outcome rows without personal data, kept after the lead is deleted", async () => {
    const { rows: cols } = await pool.query("select column_name from information_schema.columns where table_schema = 'public' and table_name = 'outcomes'");
    expect(cols.map((c) => c.column_name)).not.toEqual(expect.arrayContaining(["email"]));
    for (const forbidden of ["email", "first_name", "last_name", "company", "domain", "full_email"]) expect(cols.map((c) => c.column_name)).not.toContain(forbidden);
    const { rows } = await pool.query("select * from public.outcomes where channel = 'instantly' order by created_at");
    expect(rows).toHaveLength(10);
    expect(rows[0]).toMatchObject({ status: "pushed", skill_version: "1.0", writer: "pro", step_no: 1, slot_types: ["opener"], fact_tiers: ["A", "B"] });
    expect(rows.some((r) => r.personalised === false)).toBe(true); // the fallback lead

    const lead = rows[0].lead_id;
    await pool.query("delete from public.leads where id = $1", [lead]);
    const { rows: after } = await pool.query("select lead_id, status from public.outcomes where id = $1", [rows[0].id]);
    expect(after[0]).toEqual({ lead_id: null, status: "pushed" });
  });

  it("waits out rate limits and short outages", async () => {
    const tool = new FakeTool({ rateLimitTimes: 2, transientTimes: 1 });
    const { id, deps, sleeps } = await connect(tool);
    const camp = await campaign(3);
    const p = asPush(await createPush(pool, { workspaceId: ws, campaignId: camp.id, integrationId: id, toolCampaignId: "fake-camp-2", toolCampaignName: null, variableMap: map, kind: "full", userId: null }));
    const r = await runPush(pool, p.id, deps);
    expect(r).toMatchObject({ status: "done", added: 3 });
    expect(sleeps.length).toBe(3);
  });

  it("resumes after a crash without adding anyone twice", async () => {
    const tool = new FakeTool({ batchSize: 2 });
    const { id, deps } = await connect(tool);
    const camp = await campaign(5);
    const p = asPush(await createPush(pool, { workspaceId: ws, campaignId: camp.id, integrationId: id, toolCampaignId: "fake-camp-1", toolCampaignName: null, variableMap: map, kind: "full", userId: null }));
    // A worker claimed it and died: the lease is still valid, so nobody else takes it…
    expect(await claimPush(pool, p.id)).not.toBeNull();
    expect(await runPush(pool, p.id, deps)).toBeNull();
    // …until the lease runs out.
    await pool.query("update public.pushes set lease_until = now() - interval '1 second' where id = $1", [p.id]);
    expect(await pushesToResume(pool)).toContain(p.id);
    const r = await runPush(pool, p.id, deps);
    expect(r).toMatchObject({ status: "done", added: 5 });
    expect(await pushesToResume(pool)).not.toContain(p.id);
  });

  it("a batch the tool already took is not added again (same idempotency key)", async () => {
    const sim = instantlySim();
    const tool = new InstantlyTool("test-key", sim.fetch);
    const { id, deps } = await connect(tool);
    const camp = await campaign(3);
    const toolCampaign = sim.state.campaigns[0].id;
    const p = asPush(await createPush(pool, { workspaceId: ws, campaignId: camp.id, integrationId: id, toolCampaignId: toolCampaign, toolCampaignName: null, variableMap: map, kind: "full", userId: null }));
    // Simulate: the first attempt reached Instantly, then the worker crashed before saving the result.
    const realPush = tool.pushLeads.bind(tool);
    let crashed = false;
    tool.pushLeads = async (...a) => {
      const res = await realPush(...a);
      if (!crashed) {
        crashed = true;
        throw new Error("worker crashed");
      }
      return res;
    };
    const first = await runPush(pool, p.id, deps);
    expect(first?.status).toBe("failed");
    expect(await retryFailed(pool, ws, p.id)).toBe(3);
    tool.pushLeads = realPush;
    const r = await runPush(pool, p.id, deps);
    // Instantly answers the replayed batch with the leads it already created: they count as added once.
    expect(r).toMatchObject({ status: "done", added: 3, failed: 0 });
    expect(sim.state.leads.filter((l) => l.campaign === toolCampaign)).toHaveLength(3); // no duplicates in Instantly
  });

  it("marks a refused batch failed, and Retry failed sends it again", async () => {
    const tool = new FakeTool();
    const { id, deps } = await connect(tool);
    const camp = await campaign(4);
    const p = asPush(await createPush(pool, { workspaceId: ws, campaignId: camp.id, integrationId: id, toolCampaignId: "fake-camp-1", toolCampaignName: null, variableMap: map, kind: "full", userId: null }));
    const real = tool.pushLeads.bind(tool);
    tool.pushLeads = async () => {
      throw new ToolError("invalid", "custom_variables value too long");
    };
    const r = await runPush(pool, p.id, deps);
    expect(r).toMatchObject({ status: "done", added: 0, failed: 4 });
    expect((await pushItems(pool, ws, p.id))[0].reason).toBe("custom_variables value too long");
    tool.pushLeads = real;
    expect(await retryFailed(pool, ws, p.id)).toBe(4);
    expect(await runPush(pool, p.id, deps)).toMatchObject({ status: "done", added: 4, failed: 0 });
  });

  it("stops with a clear message when the key stops working", async () => {
    const tool = new FakeTool();
    const { id, deps } = await connect(tool);
    const camp = await campaign(2);
    const p = asPush(await createPush(pool, { workspaceId: ws, campaignId: camp.id, integrationId: id, toolCampaignId: "fake-camp-2", toolCampaignName: null, variableMap: map, kind: "full", userId: null }));
    tool.ensureVariables = async () => {
      throw new ToolError("auth", "Instantly rejected the API key.");
    };
    expect(await runPush(pool, p.id, deps)).toMatchObject({ status: "failed", error: "Instantly rejected the API key.", failed: 2 });
  });
});

describe("tool events", () => {
  it("applies reply, bounce and unsubscribe exactly once; bounces and unsubscribes are suppressed", async () => {
    const tool = new FakeTool();
    const { id, deps } = await connect(tool);
    const camp = await campaign(3, ["a@ev.nl", "b@ev.nl", "c@ev.nl"]);
    const p = asPush(await createPush(pool, { workspaceId: ws, campaignId: camp.id, integrationId: id, toolCampaignId: "fake-camp-2", toolCampaignName: null, variableMap: map, kind: "full", userId: null }));
    await runPush(pool, p.id, deps);

    const at = "2026-11-12T10:00:00.000Z";
    const events = [
      { type: "sent" as const, toolCampaignId: "fake-camp-2", email: "a@ev.nl", at },
      { type: "replied" as const, toolCampaignId: "fake-camp-2", email: "A@EV.NL", at },
      { type: "bounced" as const, toolCampaignId: "fake-camp-2", email: "b@ev.nl", at },
      { type: "unsubscribed" as const, toolCampaignId: "fake-camp-2", email: "c@ev.nl", at },
      { type: "replied" as const, toolCampaignId: "fake-camp-2", email: "stranger@else.nl", at },
    ];
    expect(await applyToolEvents(pool, id, events, "webhook")).toEqual({ applied: 4, duplicate: 0, unmatched: 1 });
    // The tool retries its webhook, and polling sees the same thing: nothing changes twice.
    expect(await applyToolEvents(pool, id, events, "poll")).toEqual({ applied: 0, duplicate: 5, unmatched: 0 });

    const items = await pushItems(pool, ws, p.id);
    expect(items.find((i) => i.email === "a@ev.nl")).toMatchObject({ replied: true, bounced: false });
    expect(items.find((i) => i.email === "b@ev.nl")).toMatchObject({ bounced: true });
    const { rows: sup } = await pool.query("select email, reason from public.suppression where email in ('a@ev.nl', 'b@ev.nl', 'c@ev.nl') order by email");
    expect(sup).toEqual([{ email: "b@ev.nl", reason: "bounce" }, { email: "c@ev.nl", reason: "unsub" }]);
    const { rows: oc } = await pool.query(
      "select l.email, o.status, o.sent_at is not null sent from public.outcomes o join public.leads l on l.id = o.lead_id where o.campaign_id = $1 order by l.email",
      [camp.id],
    );
    expect(oc).toEqual([
      { email: "a@ev.nl", status: "replied", sent: true },
      { email: "b@ev.nl", status: "bounced", sent: true },
      { email: "c@ev.nl", status: "unsubscribed", sent: true },
    ]);
    const { rows: stored } = await pool.query("select * from public.integration_events where integration_id = $1", [id]);
    expect(JSON.stringify(stored)).not.toMatch(/ev\.nl|stranger/);
  });

  it("polls tools without webhooks every 15 minutes", async () => {
    const tool = new FakeTool({ webhooks: false });
    const { id, deps } = await connect(tool, { webhooks: false });
    const camp = await campaign(2, ["p1@poll.nl", "p2@poll.nl"]);
    const p = asPush(await createPush(pool, { workspaceId: ws, campaignId: camp.id, integrationId: id, toolCampaignId: "fake-camp-1", toolCampaignName: null, variableMap: map, kind: "full", userId: null }));
    await runPush(pool, p.id, deps);
    tool.polled = [{ type: "replied", toolCampaignId: "fake-camp-1", email: "p2@poll.nl", at: "2026-11-12T10:00:00Z" }];
    const now = new Date();
    expect((await pollIntegrations(pool, deps, now)).applied).toBe(1);
    expect((await pollIntegrations(pool, deps, new Date(now.getTime() + 60_000))).polled).toBe(0); // too soon
    expect((await pushItems(pool, ws, p.id)).find((i) => i.email === "p2@poll.nl")?.replied).toBe(true);
  });

  it("Gmail and CSV exports write outcome rows too", async () => {
    const camp = await campaign(2, ["g1@mail.nl", "g2@mail.nl"]);
    await pool.query("select public.record_outcomes($1::uuid[], 1, 'csv', 'exported')", [camp.leads]);
    await pool.query("select public.record_outcomes($1::uuid[], 1, 'csv', 'exported')", [camp.leads]); // export twice: still one row each
    await pool.query("select public.record_outcomes($1::uuid[], 1, 'gmail', 'replied')", [[camp.leads[0]]]);
    await pool.query("select public.record_outcomes($1::uuid[], 1, 'gmail', 'sent')", [[camp.leads[0]]]); // never moves back
    const { rows } = await pool.query("select channel, status from public.outcomes where campaign_id = $1 order by channel, status", [camp.id]);
    expect(rows).toEqual([
      { channel: "csv", status: "exported" },
      { channel: "csv", status: "exported" },
      { channel: "gmail", status: "replied" },
    ]);
  });
});
