// A throwaway FirstLine API for testing n8n / Make against, without touching the real database:
// embedded Postgres + all migrations + the real /api/v1 handlers + the real engine with a fake
// website reader and the fake LLM. Prints a test API key (valid only in this sandbox).
//   npx tsx scripts/api-sandbox.ts [port]
import EmbeddedPostgres from "embedded-postgres";
import { mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import path from "node:path";
import pg from "pg";
import { completeJobsFor, createApiKey } from "@/api/core-pg";
import { getCredits, getJob, personalize, personalizeBatch, type ApiDeps } from "@/api/handlers";
import { openApiSpec } from "@/api/openapi";
import { engineConfig } from "@/engine/config";
import type { WebReader } from "@/engine/firecrawl";
import { FakeLLM } from "@/engine/llm-fake";
import { processLead } from "@/engine/pipeline";
import { PgStore } from "@/engine/store-pg";

const PORT = Number(process.argv[2] ?? 3999);
const root = path.resolve(__dirname, "..");

const reader: WebReader = {
  robots: async () => null,
  map: async (url) => ({ links: [{ url: `${url.replace(/\/$/, "")}/over-ons` }], credits: 1 }),
  scrape: async (url) => ({
    markdown: url.endsWith("over-ons")
      ? "# About us\n\nFounded in 1987, the bakery bakes fresh bread every morning in Utrecht and supplies forty restaurants in the region. A team of twelve bakers works in two shifts."
      : "# Bakery\n\nCraft bakery in Utrecht with its own sourdough line and delivery to restaurants across the province. This year they opened a second shop in Amersfoort.",
    statusCode: 200,
    credits: 1,
  }),
};

async function main() {
  const dir = mkdtempSync(path.join(tmpdir(), "firstline-sandbox-"));
  const dbPort = 47_000 + Math.floor(Math.random() * 1_000);
  const server = new EmbeddedPostgres({ databaseDir: dir, user: "postgres", password: "sandbox", port: dbPort, persistent: false, onLog: () => {} });
  await server.initialise();
  await server.start();
  const pool = new pg.Pool({ host: "127.0.0.1", port: dbPort, user: "postgres", password: "sandbox", database: "postgres", max: 10 });
  await pool.query(readFileSync(path.join(root, "supabase/tests/supabase-shim.sql"), "utf8"));
  for (const f of readdirSync(path.join(root, "supabase/migrations")).filter((f) => f.endsWith(".sql")).sort()) {
    await pool.query(readFileSync(path.join(root, "supabase/migrations", f), "utf8"));
  }
  const user = "00000000-0000-0000-0000-000000005a4d";
  await pool.query("insert into auth.users (id, email) values ($1, 'sandbox@firstline.test')", [user]);
  const ws = (await pool.query("select id from public.workspaces where owner_id = $1", [user])).rows[0].id;
  await pool.query("select public.add_purchase($1, 100, 'sandbox:1', 'Sandbox credits')", [ws]);
  const { key } = await createApiKey(pool, ws, "sandbox", user);

  const store = new PgStore(pool);
  const engine = { store, reader, llm: new FakeLLM(), config: engineConfig({}) };
  const deps: ApiDeps = {
    pool,
    enqueue: async (leads) => {
      // Like the worker: process in the background, then finish the job.
      void (async () => {
        for (const l of leads) {
          await processLead(l.leadId, engine, { preview: false }).catch((e) => console.error("lead failed:", e.message));
          await completeJobsFor(pool, l.leadId);
        }
      })();
    },
  };

  const http = createServer(async (req, res) => {
    const url = new URL(req.url ?? "/", `http://localhost:${PORT}`);
    const chunks: Buffer[] = [];
    for await (const c of req) chunks.push(c as Buffer);
    const apiReq = { headers: { get: (n: string) => (req.headers[n.toLowerCase()] as string | undefined) ?? null }, body: Buffer.concat(chunks).toString("utf8"), query: Object.fromEntries(url.searchParams) };
    const m = url.pathname.match(/^\/api\/v1\/jobs\/([^/]+)$/);
    const r =
      req.method === "POST" && url.pathname === "/api/v1/personalize" ? await personalize(deps, apiReq)
      : req.method === "POST" && url.pathname === "/api/v1/personalize/batch" ? await personalizeBatch(deps, apiReq)
      : req.method === "GET" && m ? await getJob(deps, apiReq, m[1])
      : req.method === "GET" && url.pathname === "/api/v1/credits" ? await getCredits(deps, apiReq)
      : req.method === "GET" && url.pathname === "/api/v1/openapi.json" ? { status: 200, body: openApiSpec(`http://localhost:${PORT}`), headers: {} }
      : { status: 404, body: { error: { code: "not_found", message: "No such endpoint" } }, headers: {} };
    console.log(`${req.method} ${url.pathname} → ${r.status}`);
    res.writeHead(r.status, { "Content-Type": "application/json", ...r.headers });
    res.end(JSON.stringify(r.body));
  });
  http.listen(PORT, "0.0.0.0", () => {
    const keyFile = path.join(dir, "..", "firstline-sandbox-key.txt");
    writeFileSync(keyFile, key);
    console.log(`FirstLine API sandbox on http://localhost:${PORT}/api/v1 (100 test credits; test output, no AI)`);
    console.log(`Sandbox API key written to ${keyFile}`);
  });
  const stop = async () => {
    http.close();
    await pool.end();
    await server.stop();
    rmSync(dir, { recursive: true, force: true });
    process.exit(0);
  };
  process.on("SIGINT", () => void stop());
  process.on("SIGTERM", () => void stop());
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
