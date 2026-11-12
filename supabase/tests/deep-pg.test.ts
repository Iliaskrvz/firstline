// Integration: Deep research on a real Postgres 17 (embedded) with the real PgStore, a fake website/search
// and the fake LLM. Person facts live only on the lead (deleted with it), never in the shared domain
// cache, never reused across workspaces, and suppressed contacts are never searched.
import EmbeddedPostgres from "embedded-postgres";
import { mkdtempSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { endCampaign, runRetention } from "@/billing/retention";
import { engineConfig } from "@/engine/config";
import type { WebReader } from "@/engine/firecrawl";
import { FakeLLM } from "@/engine/llm-fake";
import { processLead } from "@/engine/pipeline";
import { PgStore } from "@/engine/store-pg";

const root = path.resolve(__dirname, "..");
const A = "00000000-0000-0000-0000-00000000dd01";
const B = "00000000-0000-0000-0000-00000000dd02";
const TALK_URL = "https://packagingdays.nl/sprekers/anna-de-vries";
const SITE: Record<string, string> = {
  "https://acmestudio.nl/": "# Acme Studio\n\nAcme Studio designs packaging for independent food brands across the Netherlands. From the first sketch to the printed box, one team handles the whole process.",
  "https://acmestudio.nl/over-ons": "# Over ons\n\nWe started in 2012 as a two-person studio in Utrecht and now have a team of twelve designers working for food brands.",
  [TALK_URL]: "# Packaging Days 2026\n\nAnna de Vries, founder of Acme Studio, gave a talk on refill packaging for small food brands at Packaging Days in Utrecht.",
};
const searches: string[] = [];
const reader: WebReader = {
  robots: async () => null,
  map: async () => ({ links: Object.keys(SITE).filter((u) => u.includes("acmestudio")).map((url) => ({ url })), credits: 1 }),
  scrape: async (url) => ({ markdown: SITE[url] ?? "", statusCode: SITE[url] ? 200 : 404, credits: 1 }),
  search: async (q) => {
    searches.push(q);
    return { results: [{ url: TALK_URL, title: "Anna de Vries · Packaging Days", description: "Talk by Anna de Vries" }], credits: 2 };
  },
};

let server: EmbeddedPostgres;
let pool: pg.Pool;
let dir: string;
const ws: Record<string, string> = {};

async function lead(owner: string, deep: boolean, email = "anna@acmestudio.nl") {
  const w = ws[owner];
  const t = await pool.query(
    "insert into public.templates (workspace_id, name, subject, body) values ($1, 'T', 'Idea', 'Hi {{first_name}},\n\n[[opener · something specific · 25]]\n\nBest') returning id",
    [w],
  );
  const c = (await pool.query("insert into public.campaigns (workspace_id, name, template_id, status, depth) values ($1, 'C', $2, 'running', $3) returning id", [w, t.rows[0].id, JSON.stringify({ deep })]))
    .rows[0].id as string;
  const l = (
    await pool.query(
      "insert into public.leads (workspace_id, campaign_id, email, first_name, last_name, company, title, website, domain) values ($1, $2, $3, 'Anna', 'de Vries', 'Acme Studio', 'Founder', 'acmestudio.nl', 'acmestudio.nl') returning id",
      [w, c, email],
    )
  ).rows[0].id as string;
  return { campaign: c, lead: l };
}

const deps = () => ({ store: new PgStore(pool), reader, llm: new FakeLLM(), config: engineConfig({ DEEP_RESEARCH_ENABLED: "1" }) });

beforeAll(async () => {
  dir = mkdtempSync(path.join(tmpdir(), "firstline-deep-"));
  const port = 41_000 + Math.floor(Math.random() * 1_000);
  server = new EmbeddedPostgres({ databaseDir: dir, user: "postgres", password: "test", port, persistent: false, onLog: () => {} });
  await server.initialise();
  await server.start();
  pool = new pg.Pool({ host: "127.0.0.1", port, user: "postgres", password: "test", database: "postgres", max: 10 });
  await pool.query(readFileSync(path.join(root, "tests/supabase-shim.sql"), "utf8"));
  for (const f of readdirSync(path.join(root, "migrations")).filter((f) => f.endsWith(".sql")).sort()) {
    await pool.query(readFileSync(path.join(root, "migrations", f), "utf8"));
  }
  for (const [id, email] of [
    [A, "a@agency-a.nl"],
    [B, "b@agency-b.nl"],
  ]) {
    await pool.query("insert into auth.users (id, email) values ($1, $2)", [id, email]);
    ws[id] = (await pool.query("select id from public.workspaces where owner_id = $1", [id])).rows[0].id;
  }
}, 120_000);

afterAll(async () => {
  await pool?.end();
  await server?.stop();
  rmSync(dir, { recursive: true, force: true });
});

describe("Deep research data handling", () => {
  let a: { campaign: string; lead: string };

  it("stores person facts only with the lead; the shared domain cache has none", async () => {
    a = await lead(A, true);
    expect((await processLead(a.lead, deps(), { preview: true })).outcome).toBe("done");
    const { rows } = await pool.query("select deep_status, person_facts from public.leads where id = $1", [a.lead]);
    expect(rows[0].deep_status).toBe("matched");
    expect(rows[0].person_facts).toEqual([{ id: "P1", text: expect.stringContaining("gave a talk"), src: TALK_URL, tier: "D" }]);
    const cache = (await pool.query("select facts from public.domain_research where domain = 'acmestudio.nl'")).rows[0].facts;
    expect(JSON.stringify(cache)).not.toMatch(/Packaging Days|"D"/);
    const gen = (await pool.query("select facts_used, research from public.generations where lead_id = $1", [a.lead])).rows[0];
    expect(gen.facts_used).toEqual(["P1"]);
    expect(gen.research.person.status).toBe("matched");
    expect(searches).toHaveLength(1);
  });

  it("another workspace gets nothing from it: its own search, or none at all without Deep", async () => {
    const off = await lead(B, false);
    await processLead(off.lead, deps(), { preview: true });
    expect((await pool.query("select deep_status, person_facts from public.leads where id = $1", [off.lead])).rows[0]).toEqual({ deep_status: null, person_facts: null });
    expect((await pool.query("select facts_used from public.generations where lead_id = $1", [off.lead])).rows[0].facts_used).not.toContain("P1");
    expect(searches).toHaveLength(1);

    const on = await lead(B, true, "anna+b@acmestudio.nl");
    await processLead(on.lead, deps(), { preview: true });
    expect(searches).toHaveLength(2); // searched again for this workspace, not reused
  });

  it("never searches a contact on the workspace's do-not-contact list", async () => {
    await pool.query("insert into public.suppression (workspace_id, email, reason) values ($1, 'stop@acmestudio.nl', 'unsub')", [ws[A]]);
    const s = await lead(A, true, "stop@acmestudio.nl");
    await processLead(s.lead, deps(), { preview: true });
    expect(searches).toHaveLength(2);
    expect((await pool.query("select deep_status, deep_detail from public.leads where id = $1", [s.lead])).rows[0]).toEqual({
      deep_status: "not_searched",
      deep_detail: "On the do-not-contact list: not searched",
    });
  });

  it("person facts are deleted with the lead data, 30 days after the campaign ends", async () => {
    await endCampaign(pool, ws[A], a.campaign);
    await runRetention(pool, new Date(Date.now() + 31 * 86_400_000));
    expect((await pool.query("select count(*)::int n from public.leads where id = $1", [a.lead])).rows[0].n).toBe(0);
    expect((await pool.query("select count(*)::int n from public.generations where lead_id = $1", [a.lead])).rows[0].n).toBe(0);
    expect((await pool.query("select count(*)::int n from public.leads where person_facts::text like '%Packaging Days%' and workspace_id = $1 and campaign_id = $2", [ws[A], a.campaign])).rows[0].n).toBe(0);
  });
});
