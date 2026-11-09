// Integration: migrations + PgStore + pg-boss queue + pipeline on a real
// Postgres 17 (embedded, no Docker). Website and LLM are fakes, so it's offline.
import EmbeddedPostgres from "embedded-postgres";
import { mkdtempSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import pg from "pg";
import { PgBoss } from "pg-boss";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { engineConfig } from "@/engine/config";
import type { WebReader } from "@/engine/firecrawl";
import { FakeLLM } from "@/engine/llm-fake";
import { processLead } from "@/engine/pipeline";
import { PgStore } from "@/engine/store-pg";
import { LEAD_QUEUE, leadJobId, type LeadJobData } from "@/lib/queue";

const root = path.resolve(__dirname, "..");
const USER = "00000000-0000-0000-0000-0000000000dd";
let server: EmbeddedPostgres;
let pool: pg.Pool;
let boss: PgBoss;
let dir: string;
let port: number;
let ws: string;
let campaign: string;
const leads: string[] = [];

const reader: WebReader = {
  robots: async () => null,
  map: async () => ({ links: [{ url: "https://bakkerij.nl/over-ons" }], credits: 1 }),
  scrape: async (url) => ({
    markdown: url.endsWith("over-ons")
      ? "# Over ons\n\nBakkerij Bos bakt sinds 1987 elke ochtend vers brood in Utrecht en levert aan veertig restaurants in de regio. Het team van twaalf bakkers werkt in twee ploegen."
      : "# Bakkerij Bos\n\nAmbachtelijke bakkerij in Utrecht met een eigen zuurdesemlijn en bezorging aan horeca in de hele provincie. Dit jaar openden ze een tweede winkel in Amersfoort.",
    statusCode: 200,
    credits: 1,
  }),
};

beforeAll(async () => {
  dir = mkdtempSync(path.join(tmpdir(), "firstline-eng-"));
  port = 56_000 + Math.floor(Math.random() * 4_000);
  server = new EmbeddedPostgres({ databaseDir: dir, user: "postgres", password: "test", port, persistent: false, onLog: () => {} });
  await server.initialise();
  await server.start();
  pool = new pg.Pool({ host: "127.0.0.1", port, user: "postgres", password: "test", database: "postgres", max: 10 });
  await pool.query(readFileSync(path.join(root, "tests/supabase-shim.sql"), "utf8"));
  for (const f of readdirSync(path.join(root, "migrations")).filter((f) => f.endsWith(".sql")).sort()) {
    await pool.query(readFileSync(path.join(root, "migrations", f), "utf8"));
  }
  await pool.query("insert into auth.users (id, email) values ($1, 'e@e.nl')", [USER]);
  ws = (await pool.query("select id from public.workspaces where owner_id = $1", [USER])).rows[0].id;
  const t = await pool.query(
    `insert into public.templates (workspace_id, name, subject, body) values ($1, 'T', 'Idee voor {{company}}',
     'Hoi {{first_name}},\n\n[[opener · iets specifieks van hun website · 25]]\n\nWij helpen bakkerijen met hun administratie.') returning id`,
    [ws],
  );
  campaign = (await pool.query("insert into public.campaigns (workspace_id, name, template_id) values ($1, 'C', $2) returning id", [ws, t.rows[0].id])).rows[0].id;
  for (const [email, domain] of [["pieter@bakkerij.nl", "bakkerij.nl"], ["kees@bakkerij.nl", "bakkerij.nl"], ["x@none.nl", null]]) {
    const r = await pool.query(
      "insert into public.leads (campaign_id, workspace_id, email, first_name, company, domain) values ($1, $2, $3, 'Pieter', 'Bakkerij Bos', $4) returning id",
      [campaign, ws, email, domain],
    );
    leads.push(r.rows[0].id);
  }
  boss = new PgBoss({ host: "127.0.0.1", port, user: "postgres", password: "test", database: "postgres", schema: "pgboss", max: 4 });
  boss.on("error", () => {});
  await boss.start();
  await boss.createQueue(LEAD_QUEUE, { retryLimit: 2, retryDelay: 1, retryBackoff: true });
}, 180_000);

afterAll(async () => {
  await boss?.stop({ graceful: false }).catch(() => {});
  await pool?.end();
  await server?.stop();
  rmSync(dir, { recursive: true, force: true });
});

describe("worker path on real Postgres", () => {
  it("enqueues once per lead, processes jobs and stores results", async () => {
    const run = "run-1";
    const ids = await Promise.all(
      leads.map((leadId) =>
        boss.send(LEAD_QUEUE, { leadId, workspaceId: ws, preview: true, force: false } satisfies LeadJobData, { id: leadJobId(leadId, run), group: { id: ws } }),
      ),
    );
    expect(ids.every(Boolean)).toBe(true);
    // Same lead + same run = same job id: not queued twice.
    const dup = await boss.send(LEAD_QUEUE, { leadId: leads[0], workspaceId: ws, preview: true, force: false }, { id: leadJobId(leads[0], run), group: { id: ws } }).catch(() => null);
    expect(dup).toBeNull();

    const store = new PgStore(pool);
    const config = engineConfig({});
    const llm = new FakeLLM();
    let processed = 0;
    await boss.work<LeadJobData>(LEAD_QUEUE, { localConcurrency: 3, groupConcurrency: 2, pollingIntervalSeconds: 0.5 }, async ([job]) => {
      await processLead(job.data.leadId, { store, reader, llm, config }, { preview: true });
      processed++;
    });
    for (let i = 0; i < 60 && processed < 3; i++) await new Promise((r) => setTimeout(r, 250));
    expect(processed).toBe(3);

    const statuses = (await pool.query("select email, status, status_detail, confidence from public.leads order by email")).rows;
    expect(statuses).toEqual([
      { email: "kees@bakkerij.nl", status: "done", status_detail: null, confidence: expect.any(String) },
      { email: "pieter@bakkerij.nl", status: "done", status_detail: null, confidence: expect.any(String) },
      { email: "x@none.nl", status: "fallback", status_detail: "No website in the CSV", confidence: "low" },
    ]);

    const gens = (await pool.query("select provider, is_preview, research->>'status' as rs, slot_outputs from public.generations")).rows;
    expect(gens).toHaveLength(3);
    expect(gens.every((g) => g.provider === "fake" && g.is_preview)).toBe(true);

    // The second lead at the same domain used the cache: only one research run was paid for.
    const costs = (await pool.query("select model, count(*)::int as n from public.usage_costs group by model order by model")).rows;
    expect(costs).toEqual([
      { model: "firecrawl-map", n: 1 },
      { model: "firecrawl-scrape", n: 2 },
    ]);
    const cache = (await pool.query("select domain, status, extractor, jsonb_array_length(facts) as n from public.domain_research")).rows;
    expect(cache).toEqual([{ domain: "bakkerij.nl", status: "ok", extractor: "fake", n: expect.any(Number) }]);
    expect(cache[0].n).toBeGreaterThan(0);
  }, 60_000);

  it("users can read their own preview results through RLS, not others'", async () => {
    const c = await pool.connect();
    try {
      await c.query("begin");
      await c.query("set local role authenticated");
      await c.query("select set_config('request.jwt.claim.sub', $1, true)", [USER]);
      const mine = await c.query("select count(*)::int as n from public.generations");
      const costs = await c.query("select count(*)::int as n from public.usage_costs");
      const status = await c.query("select * from public.worker_status()");
      await c.query("select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000099', true)");
      const other = await c.query("select count(*)::int as n from public.generations");
      await c.query("rollback");
      expect([mine.rows[0].n, costs.rows[0].n, other.rows[0].n]).toEqual([3, 3, 0]);
      expect(status.rows[0]).toMatchObject({ workers: 0, seconds_ago: null });
    } finally {
      c.release();
    }
  });
});
