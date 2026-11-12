// Load test (Phase 10): N leads through the real queue, engine, ledger and shared limits, on a throwaway
// Postgres, with several "workers" (separate pools + pg-boss instances), a deliberately slow fake Firecrawl
// and the fake LLM. Reports throughput and where time goes.
//   npx tsx scripts/load-test.ts [leads=5000] [workers=2] [firecrawlSlots=10] [mapMs=100] [scrapeMs=200] [wsLimit=40] [perWorker=20]
import EmbeddedPostgres from "embedded-postgres";
import { mkdtempSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import pg from "pg";
import { PgBoss } from "pg-boss";
import { reserveForRun } from "@/billing/db";
import { engineConfig } from "@/engine/config";
import type { WebReader } from "@/engine/firecrawl";
import { acquireWorkspaceSlot, PgSlotGate, releaseWorkspaceSlot } from "@/engine/limiter-pg";
import { FakeLLM } from "@/engine/llm-fake";
import { processLead } from "@/engine/pipeline";
import { PgStore } from "@/engine/store-pg";
import { LEAD_QUEUE, leadJobId, type LeadJobData } from "@/lib/queue";

const [LEADS, WORKERS, FC_SLOTS, MAP_MS, SCRAPE_MS, WS_LIMIT, PER_WORKER] = [5000, 2, 10, 100, 200, 40, 20].map((d, i) => Number(process.argv[2 + i] ?? d));
const root = path.resolve(__dirname, "..");
const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

const fc = { calls: 0, maps: 0, scrapes: 0, busyMs: 0, inFlight: 0, maxInFlight: 0 };
const slowReader: WebReader = {
  robots: async () => null,
  map: async (url) => {
    fc.calls++;
    fc.maps++;
    fc.inFlight++;
    fc.maxInFlight = Math.max(fc.maxInFlight, fc.inFlight);
    await wait(MAP_MS);
    fc.busyMs += MAP_MS;
    fc.inFlight--;
    const base = url.replace(/\/$/, "");
    return { links: [{ url: `${base}/over-ons` }, { url: `${base}/nieuws` }, { url: `${base}/team` }], credits: 1 };
  },
  scrape: async (url) => {
    fc.calls++;
    fc.scrapes++;
    fc.inFlight++;
    fc.maxInFlight = Math.max(fc.maxInFlight, fc.inFlight);
    await wait(SCRAPE_MS);
    fc.busyMs += SCRAPE_MS;
    fc.inFlight--;
    return {
      markdown: `# ${url}\n\nFounded in 1987, the company bakes fresh bread every morning in Utrecht and supplies forty restaurants in the region. This year they opened a second shop in Amersfoort and hired six new bakers.`,
      statusCode: 200,
      credits: 1,
    };
  },
};

async function main() {
  const dir = mkdtempSync(path.join(tmpdir(), "firstline-load-"));
  const port = 46_000 + Math.floor(Math.random() * 1_000);
  const server = new EmbeddedPostgres({ databaseDir: dir, user: "postgres", password: "load", port, persistent: false, onLog: () => {} });
  await server.initialise();
  await server.start();
  const cfg = { host: "127.0.0.1", port, user: "postgres", password: "load", database: "postgres" };
  const admin = new pg.Pool({ ...cfg, max: 5 });
  await admin.query(readFileSync(path.join(root, "supabase/tests/supabase-shim.sql"), "utf8"));
  for (const f of readdirSync(path.join(root, "supabase/migrations")).filter((f) => f.endsWith(".sql")).sort()) {
    await admin.query(readFileSync(path.join(root, "supabase/migrations", f), "utf8"));
  }
  const user = "00000000-0000-0000-0000-0000000010ad";
  await admin.query("insert into auth.users (id, email) values ($1, 'load@test.nl')", [user]);
  const ws = (await admin.query("select id from public.workspaces where owner_id = $1", [user])).rows[0].id as string;
  await admin.query("select public.add_purchase($1, $2, 'load:1', 'Load test')", [ws, LEADS * 2]);
  const t = await admin.query(
    "insert into public.templates (workspace_id, name, subject, body) values ($1, 'T', 'Idea for {{company}}', 'Hi {{first_name}},\n\n[[opener · something specific from their website · 25]]\n\nWe help bakeries.') returning id",
    [ws],
  );
  const campaign = (await admin.query("insert into public.campaigns (workspace_id, name, template_id, status) values ($1, 'Load', $2, 'running') returning id", [ws, t.rows[0].id])).rows[0].id;
  await admin.query(
    `insert into public.leads (workspace_id, campaign_id, email, first_name, company, domain, website)
     select $1, $2, 'lead' || g || '@shop' || g || '.nl', 'Name' || g, 'Shop ' || g, 'shop' || g || '.nl', 'https://shop' || g || '.nl'
       from generate_series(1, $3) g`,
    [ws, campaign, LEADS],
  );
  const leadIds = (await admin.query("select id from public.leads where campaign_id = $1 order by created_at", [campaign])).rows.map((r) => r.id as string);
  const r = await reserveForRun(admin, { workspaceId: ws, leadIds, perLead: 1 });
  if (!r.ok) throw new Error("reserve failed");

  const boss0 = new PgBoss({ ...cfg, schema: "pgboss", max: 4 });
  await boss0.start();
  await boss0.createQueue(LEAD_QUEUE, { retryLimit: 3, retryDelay: 5, retryBackoff: true, expireInSeconds: 600 });
  const runId = `load-${Date.now()}`;
  for (let i = 0; i < leadIds.length; i += 500) {
    await boss0.insert(LEAD_QUEUE, leadIds.slice(i, i + 500).map((leadId) => ({ id: leadJobId(leadId, runId), data: { leadId, workspaceId: ws, preview: false, force: false } satisfies LeadJobData, group: { id: ws } })));
  }

  console.log(`${LEADS} leads queued · ${WORKERS} workers × ${PER_WORKER} at once · workspace limit ${WS_LIMIT} · Firecrawl ${FC_SLOTS} at once, map ${MAP_MS} ms, scrape ${SCRAPE_MS} ms`);
  const t0 = Date.now();
  const workerStats: { done: number; deferred: number; procMs: number; slotWaitMs: number; gate: PgSlotGate }[] = [];
  const bosses: PgBoss[] = [];
  const pools: pg.Pool[] = [admin];
  for (let w = 0; w < WORKERS; w++) {
    const pool = new pg.Pool({ ...cfg, max: PER_WORKER + 4 });
    pools.push(pool);
    const store = new PgStore(pool);
    const gate = new PgSlotGate(pool, "firecrawl", FC_SLOTS, { pollMs: 25 });
    const deps = { store, reader: slowReader, llm: new FakeLLM(), config: engineConfig({}), firecrawlGate: gate };
    const st = { done: 0, deferred: 0, procMs: 0, slotWaitMs: 0, gate };
    workerStats.push(st);
    const boss = new PgBoss({ ...cfg, schema: "pgboss", max: 4 });
    await boss.start();
    bosses.push(boss);
    await boss.work<LeadJobData>(LEAD_QUEUE, { localConcurrency: PER_WORKER, groupConcurrency: 50, pollingIntervalSeconds: 0.5 }, async ([job]) => {
      const s0 = Date.now();
      const ok = await acquireWorkspaceSlot(pool, { workspaceId: ws, leadId: job.data.leadId, workerId: `w${w}`, limit: WS_LIMIT });
      st.slotWaitMs += Date.now() - s0;
      if (!ok) {
        st.deferred++;
        await boss.send(LEAD_QUEUE, job.data, { startAfter: 1, group: { id: ws } });
        return;
      }
      const p0 = Date.now();
      try {
        await processLead(job.data.leadId, deps, { preview: false });
        st.done++;
        st.procMs += Date.now() - p0;
      } finally {
        await releaseWorkspaceSlot(pool, job.data.leadId);
      }
    });
  }

  let last = 0;
  for (;;) {
    await wait(5000);
    const done = workerStats.reduce((a, s) => a + s.done, 0);
    const el = (Date.now() - t0) / 1000;
    console.log(`${el.toFixed(0)} s: ${done} done (${((done - last) / 5) * 60} leads/min now)`);
    last = done;
    if (done >= LEADS) break;
    if (el > 3600) break;
  }
  const el = (Date.now() - t0) / 1000;
  const statuses = (await admin.query("select status, count(*)::int n from public.leads where campaign_id = $1 group by status order by status", [campaign])).rows;
  const bal = (await admin.query("select available, reserved, spent from public.workspace_balance where workspace_id = $1", [ws])).rows[0];
  const done = workerStats.reduce((a, s) => a + s.done, 0);
  const gateCalls = workerStats.reduce((a, s) => a + s.gate.stats.calls, 0);
  const gateWait = workerStats.reduce((a, s) => a + s.gate.stats.waitedMs, 0);
  const proc = workerStats.reduce((a, s) => a + s.procMs, 0);
  console.log("\n=== Result ===");
  console.log(JSON.stringify({
    leads: LEADS,
    seconds: Math.round(el),
    leadsPerMinute: Math.round((done / el) * 60),
    statuses,
    credits: bal,
    firecrawl: { calls: fc.calls, maps: fc.maps, scrapes: fc.scrapes, maxAtOnce: fc.maxInFlight, slots: FC_SLOTS, utilisation: +(fc.busyMs / (el * 1000 * FC_SLOTS)).toFixed(2) },
    perLeadMs: { total: Math.round(proc / done), waitingForFirecrawlSlot: Math.round(gateWait / done), firecrawlWork: Math.round(fc.busyMs / done) },
    gateWaitPerCallMs: Math.round(gateWait / gateCalls),
    deferredByWorkspaceLimit: workerStats.reduce((a, s) => a + s.deferred, 0),
    workers: workerStats.map((s) => ({ done: s.done, deferred: s.deferred })),
  }, null, 2));

  for (const b of bosses) await b.stop({ graceful: false });
  await boss0.stop({ graceful: false });
  for (const p of pools) await p.end();
  await server.stop();
  rmSync(dir, { recursive: true, force: true });
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
