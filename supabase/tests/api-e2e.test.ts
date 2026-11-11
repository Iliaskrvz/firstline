// End to end: the public API (/api/v1 handlers) on a real Postgres 17 (embedded) with the real engine
// (fake website reader and fake LLM), the real ledger and real outbound webhook delivery code.
// The "worker" here runs processLead for each queued lead, like worker/index.ts does.
import EmbeddedPostgres from "embedded-postgres";
import { randomBytes } from "node:crypto";
import { mkdtempSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { completeJobsFor, createApiKey, revokeApiKey, type JobView } from "@/api/core-pg";
import { getCredits, getJob, personalize, personalizeBatch, type ApiDeps, type ApiRequest } from "@/api/handlers";
import { openApiSpec } from "@/api/openapi";
import { MAX_BATCH } from "@/api/schemas";
import { createEndpoint, deliverDue, RETRY_DELAYS_S, verifySignature } from "@/api/webhooks-pg";
import { runRetention } from "@/billing/retention";
import { engineConfig } from "@/engine/config";
import type { WebReader } from "@/engine/firecrawl";
import { FakeLLM } from "@/engine/llm-fake";
import { processLead } from "@/engine/pipeline";
import { PgStore } from "@/engine/store-pg";

const root = path.resolve(__dirname, "..");
const USER = "00000000-0000-0000-0000-0000000000a9";
const KEY = randomBytes(32);

let server: EmbeddedPostgres;
let pool: pg.Pool;
let dir: string;
let ws: string;
let apiKey: string;

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

/** Leads waiting for "the worker". */
const queue: string[] = [];
async function worker() {
  const store = new PgStore(pool);
  const deps = { store, reader, llm: new FakeLLM(), config: engineConfig({}) };
  while (queue.length) {
    const id = queue.shift()!;
    await processLead(id, deps, { preview: false });
    await completeJobsFor(pool, id);
  }
}

const deps = (opts: { runNow?: boolean } = {}): ApiDeps => ({
  pool,
  enqueue: async (leads) => {
    queue.push(...leads.map((l) => l.leadId));
    if (opts.runNow) await worker();
  },
  sleep: async () => {},
});

const req = (body?: unknown, headers: Record<string, string> = {}, query: Record<string, string> = {}): ApiRequest => {
  const h = new Headers({ authorization: `Bearer ${apiKey}`, ...headers });
  return { headers: h, body: body === undefined ? undefined : JSON.stringify(body), query };
};

const COPY = { subject: "Idee voor {{company}}", body: "Hoi {{first_name}},\n\n[[opener · iets specifieks van hun website · 25]]\n\nWij helpen bakkerijen met hun administratie." };
const pieter = { email: "pieter@bakkerij.nl", first_name: "Pieter", company: "Bakkerij Bos", website: "https://bakkerij.nl" };

async function credits() {
  return (await pool.query("select available, reserved from public.workspace_balance where workspace_id = $1", [ws])).rows[0];
}

beforeAll(async () => {
  dir = mkdtempSync(path.join(tmpdir(), "firstline-api-"));
  const port = 40_000 + Math.floor(Math.random() * 3_000);
  server = new EmbeddedPostgres({ databaseDir: dir, user: "postgres", password: "test", port, persistent: false, onLog: () => {} });
  await server.initialise();
  await server.start();
  pool = new pg.Pool({ host: "127.0.0.1", port, user: "postgres", password: "test", database: "postgres", max: 10 });
  await pool.query(readFileSync(path.join(root, "tests/supabase-shim.sql"), "utf8"));
  for (const f of readdirSync(path.join(root, "migrations")).filter((f) => f.endsWith(".sql")).sort()) {
    await pool.query(readFileSync(path.join(root, "migrations", f), "utf8"));
  }
  await pool.query("insert into auth.users (id, email) values ($1, 'builder@automations.nl')", [USER]);
  ws = (await pool.query("select id from public.workspaces where owner_id = $1", [USER])).rows[0].id;
  apiKey = (await createApiKey(pool, ws, "n8n", USER)).key;
}, 120_000);

afterAll(async () => {
  await pool?.end();
  await server?.stop();
  rmSync(dir, { recursive: true, force: true });
});

describe("public API, end to end", () => {
  it("refuses calls without a valid key, and explains bad bodies", async () => {
    const noKey = await getCredits(deps(), { headers: new Headers() });
    expect(noKey).toMatchObject({ status: 401, body: { error: { code: "unauthorized" } } });
    const badKey = await getCredits(deps(), req(undefined, { authorization: `Bearer fl_live_${"0".repeat(32)}` }));
    expect(badKey.status).toBe(401);
    const bad = await personalize(deps(), req({ lead: { email: "nope" }, copy: COPY }));
    expect(bad).toMatchObject({ status: 400, body: { error: { code: "invalid_request", details: { field: "lead.email" } } } });
    const noSlots = await personalize(deps(), req({ lead: pieter, copy: { body: "Hi {{first_name}}, no slots here." } }));
    expect(noSlots.body).toMatchObject({ error: { message: expect.stringMatching(/at least one \[\[slot\]\]/) } });
    const deep = await personalize(deps(), req({ lead: pieter, copy: COPY, options: { depth: { deep: true } } }));
    expect(deep).toMatchObject({ status: 400, body: { error: { code: "not_available" } } });
  });

  it("without credits: 402, and nothing is left behind", async () => {
    const r = await personalize(deps(), req({ lead: pieter, copy: COPY }));
    expect(r).toMatchObject({ status: 402, body: { error: { code: "insufficient_credits", details: { needed: 1, available: 0 } } } });
    expect((await pool.query("select count(*)::int n from public.campaigns where source = 'api'")).rows[0].n).toBe(0);
    await pool.query("select public.add_purchase($1, 50, 'test:1', 'Test credits')", [ws]);
  });

  it("personalise one lead: 202 at once, the worker writes it, GET returns the cited result and 1 credit is used", async () => {
    const r = await personalize(deps(), req({ lead: pieter, copy: COPY }));
    expect(r.status).toBe(202);
    const job = r.body as JobView;
    expect(job).toMatchObject({ object: "job", kind: "single", status: "running", lead_count: 1 });
    expect(r.headers.Location).toBe(`/api/v1/jobs/${job.id}`);
    expect(r.headers["X-RateLimit-Limit"]).toBe("60");
    expect(await credits()).toEqual({ available: 49, reserved: 1 });

    await worker();
    const g = await getJob(deps(), req(), job.id);
    expect(g.status).toBe(200);
    const done = g.body as JobView & { result: JobView["results"][number] };
    expect(done).toMatchObject({ status: "done", credits_used: 1, counts: { personalised: 1 } });
    expect(done.result).toMatchObject({ email: "pieter@bakkerij.nl", status: "personalised", credits_used: 1, confidence: expect.any(String) });
    expect(done.result.email_body).toMatch(/^Hoi Pieter,/);
    expect(Object.keys(done.result.slots!)).toEqual(["opener"]);
    expect(done.result.sources.length).toBeGreaterThan(0);
    expect(done.result.sources[0].url).toMatch(/^https:\/\/bakkerij\.nl/);
    expect(await credits()).toEqual({ available: 49, reserved: 0 });
    // The ledger shows the API as the source; the hidden campaign isn't in the app's lists.
    const { rows } = await pool.query("select distinct source from public.credit_ledger where workspace_id = $1 and type in ('reserve', 'capture')", [ws]);
    expect(rows).toEqual([{ source: "api" }]);
    const { rows: camp } = await pool.query("select source, status, ended_at is not null ended from public.campaigns where id = (select campaign_id from public.api_jobs where id = $1)", [job.id]);
    expect(camp[0]).toEqual({ source: "api", status: "done", ended: true });
  });

  it("wait: the result comes back in the same call (n8n)", async () => {
    const r = await personalize(deps({ runNow: true }), req({ lead: { ...pieter, email: "kees@bakkerij.nl", first_name: "Kees" }, copy: COPY, wait: 30 }));
    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({ status: "done", result: { status: "personalised", email_body: expect.stringMatching(/^Hoi Kees,/) } });
  });

  it("Idempotency-Key: a retry returns the same job and never charges twice; another body is refused", async () => {
    const body = { lead: { ...pieter, email: "anna@bakkerij.nl" }, copy: COPY };
    const before = await credits();
    const a = await personalize(deps(), req(body, { "idempotency-key": "n8n-run-42" }));
    const b = await personalize(deps(), req(body, { "idempotency-key": "n8n-run-42" }));
    expect((b.body as JobView).id).toBe((a.body as JobView).id);
    expect(b.headers["Idempotent-Replayed"]).toBe("true");
    expect(queue).toHaveLength(1);
    expect((await credits()).reserved).toBe(before.reserved + 1);
    const c = await personalize(deps(), req({ ...body, lead: { ...body.lead, first_name: "Other" } }, { "idempotency-key": "n8n-run-42" }));
    expect(c).toMatchObject({ status: 422, body: { error: { code: "idempotency_conflict" } } });
    await worker();
  });

  it("batch: up to 100 leads; leads without a website fall back for free", async () => {
    const r = await personalizeBatch(
      deps({ runNow: true }),
      req({
        leads: [
          { email: "a@bakkerij.nl", first_name: "A", company: "Bakkerij Bos" },
          { email: "b@bakkerij.nl", first_name: "B", website: "bakkerij.nl" },
          { email: "someone@gmail.com", first_name: "C" },
        ],
        copy: COPY,
        wait: 30,
      }),
    );
    expect(r.status).toBe(200);
    const job = r.body as JobView;
    expect(job).toMatchObject({ kind: "batch", status: "done", counts: { personalised: 2, fallback: 1 }, credits_used: 2 });
    expect(job.results.find((x) => x.email === "someone@gmail.com")).toMatchObject({ status: "fallback", credits_used: 0 });
    const tooMany = await personalizeBatch(deps(), req({ leads: Array.from({ length: MAX_BATCH + 1 }, (_, i) => ({ email: `x${i}@y.nl` })), copy: COPY }));
    expect(tooMany.status).toBe(400);
    const dup = await personalizeBatch(deps(), req({ leads: [{ email: "d@y.nl" }, { email: "D@y.nl" }], copy: COPY }));
    expect(dup.body).toMatchObject({ error: { message: "The batch contains d@y.nl twice." } });
  });

  it("campaign_id: uses the copy of a campaign made in the app", async () => {
    const t = await pool.query("insert into public.templates (workspace_id, name, subject, body) values ($1, 'App copy', 'Vraagje', $2) returning id", [ws, "Dag {{first_name}},\n\n[[opener · iets specifieks van hun website · 25]]\n\nGroet"]);
    const c = await pool.query("insert into public.campaigns (workspace_id, name, template_id) values ($1, 'App campaign', $2) returning id", [ws, t.rows[0].id]);
    const r = await personalize(deps({ runNow: true }), req({ lead: { ...pieter, email: "jan@bakkerij.nl", first_name: "Jan" }, campaign_id: c.rows[0].id, wait: 30 }));
    expect(r.body).toMatchObject({ result: { status: "personalised", email_body: expect.stringMatching(/^Dag Jan,/) } });
    const missing = await personalize(deps(), req({ lead: pieter, campaign_id: "00000000-0000-4000-8000-000000000000" }));
    expect(missing.status).toBe(404);
  });

  it("GET /credits", async () => {
    const r = await getCredits(deps(), req());
    expect(r).toMatchObject({ status: 200, body: { object: "credits", available: expect.any(Number), reserved: 0 } });
  });

  it("signed webhooks: delivered once, retried on failure with backoff, then given up", async () => {
    const { secret } = await createEndpoint(pool, KEY, ws, "https://hooks.example.com/firstline", ["job.completed", "batch.completed"]);
    const r = await personalize(deps({ runNow: true }), req({ lead: { ...pieter, email: "hook@bakkerij.nl" }, copy: COPY }));
    const jobId = (r.body as JobView).id;
    const got: { url: string; body: string; sig: string }[] = [];
    const ok = await deliverDue(pool, KEY, async (url, init) => {
      got.push({ url, body: init.body, sig: init.headers["FirstLine-Signature"] });
      return { status: 200 };
    });
    expect(ok.delivered).toBe(1);
    expect(got[0].url).toBe("https://hooks.example.com/firstline");
    expect(verifySignature(secret, got[0].body, got[0].sig)).toBe(true);
    expect(verifySignature(secret, got[0].body.replace("hook@", "evil@"), got[0].sig)).toBe(false);
    expect(verifySignature("whsec_wrong", got[0].body, got[0].sig)).toBe(false);
    expect(JSON.parse(got[0].body)).toMatchObject({ id: `evt_${jobId}`, type: "job.completed", data: { id: jobId, status: "done" } });
    expect((await deliverDue(pool, KEY, async () => ({ status: 200 }))).delivered).toBe(0); // nothing twice

    // A receiver that is down: retried after 1 min, 5 min, …, then marked failed.
    await personalize(deps({ runNow: true }), req({ lead: { ...pieter, email: "down@bakkerij.nl" }, copy: COPY }));
    let now = new Date();
    for (let i = 0; i <= RETRY_DELAYS_S.length; i++) {
      const d = await deliverDue(pool, KEY, async () => ({ status: 500 }), now);
      expect(d.delivered).toBe(0);
      if (i < RETRY_DELAYS_S.length) {
        expect(d.retried).toBe(1);
        const next = (await pool.query("select next_attempt_at from public.webhook_deliveries where status = 'pending'")).rows[0].next_attempt_at as Date;
        expect(Math.round((next.getTime() - now.getTime()) / 1000)).toBe(RETRY_DELAYS_S[i]);
        now = next;
      } else expect(d.failed).toBe(1);
    }
  });

  it("rate limit: 60 requests per minute per key, then 429 with Retry-After", async () => {
    const other = (await createApiKey(pool, ws, "busy", USER)).key;
    const at = new Date("2026-11-12T10:00:10Z");
    const d: ApiDeps = { ...deps(), now: () => at };
    const r2 = (k: string) => getCredits(d, { headers: new Headers({ authorization: `Bearer ${k}` }) });
    for (let i = 0; i < 60; i++) expect((await r2(other)).status).toBe(200);
    const limited = await r2(other);
    expect(limited).toMatchObject({ status: 429, body: { error: { code: "rate_limited" } } });
    expect(limited.headers["Retry-After"]).toBe("50");
    expect((await r2(apiKey)).status).toBe(200); // per key
  });

  it("a revoked key stops working at once", async () => {
    const { key, row } = await createApiKey(pool, ws, "old", USER);
    expect((await getCredits(deps(), { headers: new Headers({ authorization: `Bearer ${key}` }) })).status).toBe(200);
    await revokeApiKey(pool, ws, row.id);
    expect((await getCredits(deps(), { headers: new Headers({ authorization: `Bearer ${key}` }) })).status).toBe(401);
  });

  it("API lead data is deleted 30 days after the job, like campaign data", async () => {
    const { rows } = await pool.query("select count(*)::int n from public.leads l join public.campaigns c on c.id = l.campaign_id where c.source = 'api'");
    expect(rows[0].n).toBeGreaterThan(0);
    await runRetention(pool, new Date(Date.now() + 31 * 86_400_000));
    const after = await pool.query("select count(*)::int n from public.leads l join public.campaigns c on c.id = l.campaign_id where c.source = 'api'");
    expect(after.rows[0].n).toBe(0);
  });

  it("the OpenAPI file describes the same limits", () => {
    const spec = openApiSpec("https://app.example") as { servers: { url: string }[]; paths: Record<string, unknown> };
    expect(spec.servers[0].url).toBe("https://app.example/api/v1");
    expect(Object.keys(spec.paths)).toEqual(["/personalize", "/personalize/batch", "/jobs/{id}", "/credits"]);
    expect(JSON.stringify(spec)).toContain(`"maxItems":${MAX_BATCH}`);
  });
});
