// Own use and split tests (owner's own outreach) on a real Postgres 17 (embedded) with the fake LLM:
// the per-workspace switch is server-only, its costs are own use (outside the customer margin), a split
// campaign sends the plain copy to half its leads for free, and replies marked positive are counted per half.
import EmbeddedPostgres from "embedded-postgres";
import { mkdtempSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { loadAdmin, loadCostBreakdown } from "@/billing/admin-db";
import { reserveForRun } from "@/billing/db";
import { engineConfig } from "@/engine/config";
import type { WebReader } from "@/engine/firecrawl";
import { FakeLLM } from "@/engine/llm-fake";
import { processLead } from "@/engine/pipeline";
import { PgStore } from "@/engine/store-pg";
import { llmOverride, listLlmOverrides, ownUseSpendThisMonth, setLlmOverride } from "@/lib/own-use-pg";
import { stripSlots } from "@/lib/split-test";
import { assignSplit, markReply, setSplitTest, splitTestStats } from "@/lib/split-test-pg";

const root = path.resolve(__dirname, "..");
const OWNER = "00000000-0000-4000-8000-0000000000d1";
const CUSTOMER = "00000000-0000-4000-8000-0000000000d2";
let server: EmbeddedPostgres;
let pool: pg.Pool;
let dir: string;
let ownWs: string;
let custWs: string;

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
const BODY = "Hi {{first_name}},\n\n[[opener · something specific from their website · 25]]\n\nWe help studios cut admin. Worth a call?\n\nTom";

beforeAll(async () => {
  dir = mkdtempSync(path.join(tmpdir(), "firstline-ownuse-"));
  const port = 50_000 + Math.floor(Math.random() * 2_000);
  server = new EmbeddedPostgres({ databaseDir: dir, user: "postgres", password: "test", port, persistent: false, onLog: () => {} });
  await server.initialise();
  await server.start();
  pool = new pg.Pool({ host: "127.0.0.1", port, user: "postgres", password: "test", database: "postgres", max: 10 });
  await pool.query(readFileSync(path.join(root, "tests/supabase-shim.sql"), "utf8"));
  for (const f of readdirSync(path.join(root, "migrations")).filter((f) => f.endsWith(".sql")).sort()) {
    await pool.query(readFileSync(path.join(root, "migrations", f), "utf8"));
  }
  await pool.query("insert into auth.users (id, email, email_confirmed_at) values ($1, 'owner@firstline.nl', now()), ($2, 'customer@shop.nl', now())", [OWNER, CUSTOMER]);
  ownWs = (await pool.query("select id from public.workspaces where owner_id = $1", [OWNER])).rows[0].id;
  custWs = (await pool.query("select id from public.workspaces where owner_id = $1", [CUSTOMER])).rows[0].id;
  for (const ws of [ownWs, custWs]) await pool.query("select public.add_purchase($1, 200, $2, 'test credits', 'standard')", [ws, `test:${ws}`]);
}, 120_000);

afterAll(async () => {
  await pool?.end();
  await server?.stop();
  rmSync(dir, { recursive: true, force: true });
});

async function campaign(ws: string, n: number, split = false) {
  const t = (await pool.query("insert into public.templates (workspace_id, name, subject, body, slots, style_rules) values ($1, 'T', 'Idea for {{company}}', $2, '[]', '{\"language\":\"en\"}') returning id", [ws, BODY])).rows[0].id;
  const c = (await pool.query("insert into public.campaigns (workspace_id, name, template_id, status) values ($1, 'Own test', $2, 'draft') returning id", [ws, t])).rows[0].id as string;
  if (split) expect(await setSplitTest(pool, { campaignId: c, split: { share: 0.5, plain_subject: "Idea for {{company}}", plain_body: stripSlots(BODY) } })).toEqual({ ok: true });
  const leads: string[] = [];
  for (let i = 0; i < n; i++) {
    leads.push(
      (
        await pool.query(
          "insert into public.leads (workspace_id, campaign_id, email, first_name, company, website, domain, created_at) values ($1, $2, $3, 'Anna', 'Acme Studio', 'acmestudio.nl', 'acmestudio.nl', clock_timestamp()) returning id",
          [ws, c, `lead${i}-${c.slice(0, 6)}@acmestudio.nl`],
        )
      ).rows[0].id,
    );
  }
  return { id: c, leads };
}

describe("own use", () => {
  it("the switch is server-only: logged-in users can't read or set it", async () => {
    const c = await pool.connect();
    try {
      await c.query("set role authenticated");
      await expect(c.query("select * from public.workspace_llm_overrides")).rejects.toThrow(/permission denied/);
      await expect(c.query("insert into public.workspace_llm_overrides (workspace_id, provider, set_by) values ($1, 'anthropic', 'me')", [custWs])).rejects.toThrow(/permission denied/);
    } finally {
      await c.query("reset role");
      c.release();
    }
  });

  it("switched on: its costs are own use, kept out of the customer margin and shown as Lab/own use; others unchanged", async () => {
    await setLlmOverride(pool, { workspaceId: ownWs, provider: "anthropic", setBy: "owner@firstline.nl" });
    expect(await llmOverride(pool, ownWs)).toBe("anthropic");
    expect(await llmOverride(pool, custWs)).toBeNull();
    expect((await listLlmOverrides(pool)).map((o) => o.workspace_id)).toEqual([ownWs]);

    const own = await campaign(ownWs, 1);
    const cust = await campaign(custWs, 1);
    const store = new PgStore(pool);
    await store.logCosts(own.leads[0], ownWs, [{ step: "write", model: "claude-sonnet-5-5", cost_usd: 0.5 }]);
    await store.logCosts(cust.leads[0], custWs, [{ step: "write", model: "deepseek-v4-pro", cost_usd: 0.01 }]);
    const flags = (await pool.query("select workspace_id, own_use from public.usage_costs where lead_id = any($1)", [[own.leads[0], cust.leads[0]]])).rows;
    expect(flags.find((r) => r.workspace_id === ownWs).own_use).toBe(true);
    expect(flags.find((r) => r.workspace_id === custWs).own_use).toBe(false);

    expect(await ownUseSpendThisMonth(pool)).toBeCloseTo(0.5);
    const admin = await loadAdmin(pool);
    expect(admin.days[0].costUsd).toBeCloseTo(0.01); // the customer's cost only
    const rows = await loadCostBreakdown(pool);
    expect(rows.find((r) => r.model === "claude-sonnet-5-5")?.source).toBe("lab");
    expect(rows.find((r) => r.model === "deepseek-v4-pro")?.source).toBe("customers");
  });
});

describe("split test", () => {
  it("only before the run, and half the leads become the free holdout (preview leads stay FirstLine)", async () => {
    const c = await campaign(ownWs, 10, true);
    await pool.query("update public.leads set status = 'done' where id = any($1)", [c.leads.slice(0, 2)]); // previewed
    expect(await assignSplit(pool, c.id)).toEqual({ holdout: 5, firstline: 5 });
    expect(await assignSplit(pool, c.id)).toEqual({ holdout: 5, firstline: 5 }); // idempotent
    const v = (await pool.query("select id, split_variant from public.leads where id = any($1)", [c.leads.slice(0, 2)])).rows;
    expect(v.every((r) => r.split_variant === "firstline")).toBe(true);
    expect(await setSplitTest(pool, { campaignId: c.id, split: null })).toMatchObject({ error: expect.stringMatching(/before the campaign runs/) });
  });

  it("holdout: the plain copy with the lead's name, no AI, no credits; FirstLine half written as usual", async () => {
    const c = await campaign(ownWs, 4, true);
    await assignSplit(pool, c.id);
    const rows = (await pool.query("select id, split_variant from public.leads where campaign_id = $1", [c.id])).rows;
    const holdout = rows.find((r) => r.split_variant === "holdout").id;
    const firstline = rows.find((r) => r.split_variant === "firstline").id;
    const before = (await pool.query("select available from public.workspace_balance where workspace_id = $1", [ownWs])).rows[0].available;
    await reserveForRun(pool, { workspaceId: ownWs, leadIds: rows.filter((r) => r.split_variant !== "holdout").map((r) => r.id), perLead: 1 });

    expect((await processLead(holdout, deps())).outcome).toBe("done");
    const g = (await pool.query("select subject, full_email, provider, checks, slot_outputs from public.generations where lead_id = $1", [holdout])).rows[0];
    expect(g).toMatchObject({ subject: "Idea for Acme Studio", provider: "plain", checks: { status: "holdout" }, slot_outputs: {} });
    expect(g.full_email).toBe("Hi Anna,\n\nWe help studios cut admin. Worth a call?\n\nTom");
    expect((await pool.query("select count(*)::int n from public.usage_costs where lead_id = $1", [holdout])).rows[0].n).toBe(0);

    expect((await processLead(firstline, deps())).outcome).toBe("done");
    const after = (await pool.query("select available, reserved from public.workspace_balance where workspace_id = $1", [ownWs])).rows[0];
    expect(after.available).toBe(before - 2); // 2 FirstLine leads reserved; 1 written so far, 1 still reserved
    expect(after.reserved).toBe(1);
  });

  it("replies per half, with the ones you marked positive; holdout emails never count as personalised", async () => {
    const c = await campaign(ownWs, 4, true);
    await assignSplit(pool, c.id);
    const rows = (await pool.query("select id, split_variant from public.leads where campaign_id = $1 order by split_variant", [c.id])).rows;
    for (const r of rows) await processLead(r.id, deps());
    const ids = rows.map((r) => r.id);
    await pool.query("select public.record_outcomes($1::uuid[], 1, 'gmail', 'sent')", [ids]);
    // One reply in each half; the FirstLine one is positive.
    const fl = rows.find((r) => r.split_variant === "firstline").id;
    const ho = rows.find((r) => r.split_variant === "holdout").id;
    await pool.query("select public.record_outcomes($1::uuid[], 1, 'gmail', 'replied')", [[fl, ho]]);
    const send = (
      await pool.query("insert into public.sends (lead_id, workspace_id, step_no, status, sent_at) values ($1, $2, 1, 'replied', now()) returning id", [fl, ownWs])
    ).rows[0].id;
    expect(await markReply(pool, { workspaceId: custWs, sendId: send, positive: true })).toBe(false); // another workspace
    expect(await markReply(pool, { workspaceId: ownWs, sendId: send, positive: true })).toBe(true);

    const stats = (await splitTestStats(pool)).find((s) => s.campaignId === c.id)!;
    expect(stats.holdout).toMatchObject({ contacted: 2, replied: 1, positive: 0, replyRate: 0.5, positiveRate: 0 });
    expect(stats.firstline).toMatchObject({ contacted: 2, replied: 1, positive: 1, replyRate: 0.5, positiveRate: 0.5 });
    const personalised = (await pool.query("select split_variant, bool_or(personalised) p from public.outcomes where lead_id = any($1) group by 1", [ids])).rows;
    expect(personalised.find((r) => r.split_variant === "holdout").p).toBe(false);
  });
});
