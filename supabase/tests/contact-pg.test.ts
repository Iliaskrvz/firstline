// Agencies "Talk to us" requests on a real Postgres 17 (embedded): limits (also under parallel
// requests), the admin list and the 180-day cleanup. Also the demo's language-separated cache.
import EmbeddedPostgres from "embedded-postgres";
import { mkdtempSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { DemoResult } from "@/engine/demo";
import { admitDemo, cachedDemo, finishDemo } from "@/engine/demo-pg";
import { admitContact, markContactNotified, purgeContacts, recentContacts } from "@/lib/contact";
import { freePort } from "./free-port";

const root = path.resolve(__dirname, "..");
let server: EmbeddedPostgres;
let pool: pg.Pool;
let dir: string;

beforeAll(async () => {
  dir = mkdtempSync(path.join(tmpdir(), "firstline-contact-"));
  const port = await freePort();
  server = new EmbeddedPostgres({ databaseDir: dir, user: "postgres", password: "test", port, persistent: false, onLog: () => {} });
  await server.initialise();
  await server.start();
  pool = new pg.Pool({ host: "127.0.0.1", port, user: "postgres", password: "test", database: "postgres", max: 10 });
  await pool.query(readFileSync(path.join(root, "tests/supabase-shim.sql"), "utf8"));
  for (const f of readdirSync(path.join(root, "migrations")).filter((f) => f.endsWith(".sql")).sort()) {
    await pool.query(readFileSync(path.join(root, "migrations", f), "utf8"));
  }
}, 120_000);

afterAll(async () => {
  await pool?.end();
  await server?.stop();
  rmSync(dir, { recursive: true, force: true });
});

const req = { name: "Ana", email: "ana@agency.example", company: "Agency", volume: "2,000 to 10,000", message: "Hi" };

describe("contact requests (database)", () => {
  it("3 per IP per day, stored with a hash only, listed for /admin", async () => {
    for (let i = 0; i < 3; i++) expect((await admitContact(pool, { ...req, ipHash: "ip-a" })).ok).toBe(true);
    expect(await admitContact(pool, { ...req, ipHash: "ip-a" })).toEqual({ ok: false, reason: "ip_limit" });
    const list = await recentContacts(pool);
    expect(list).toHaveLength(3);
    expect(list[0]).toMatchObject({ name: "Ana", email: "ana@agency.example", notified: false });
    await markContactNotified(pool, list[0].id);
    expect((await recentContacts(pool))[0].notified).toBe(true);
  });

  it("the daily cap holds with many requests at once", async () => {
    await pool.query("delete from public.contact_requests");
    const r = await Promise.all(Array.from({ length: 10 }, (_, i) => admitContact(pool, { ...req, ipHash: `ip${i}`, cap: 4 })));
    expect(r.filter((x) => x.ok)).toHaveLength(4);
    expect(r.filter((x) => !x.ok && x.reason === "daily_cap")).toHaveLength(6);
  });

  it("requests are deleted after 180 days", async () => {
    expect(await purgeContacts(pool, new Date(Date.now() + 179 * 86_400_000))).toBe(0);
    expect(await purgeContacts(pool, new Date(Date.now() + 181 * 86_400_000))).toBe(4);
  });
});

describe("homepage demo in two languages (database)", () => {
  it("an English result is never served to the Dutch page, and the other way round", async () => {
    const done: DemoResult = { status: "done", domain: "acme.nl", opener: "Saw the new Rotterdam studio.", sources: [], cached: false };
    const a = await admitDemo(pool, { ipHash: "x", domain: "acme.nl", sells: "", lang: "en" });
    if (!a.ok) throw new Error("not admitted");
    await finishDemo(pool, a.id, done, []);
    expect(await cachedDemo(pool, "acme.nl", "", new Date(), "en")).toMatchObject({ opener: done.opener });
    expect(await cachedDemo(pool, "acme.nl", "", new Date(), "nl")).toBeNull();
  });
});
