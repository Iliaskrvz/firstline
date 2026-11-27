// Free email checks on a real Postgres 17 (embedded) with a fake DNS resolver: the 7-day domain cache,
// invalid leads skipped with their credits released, "exclude risky" / "include again", the worker's
// round, and the pre-send refusal in the sending lanes.
import EmbeddedPostgres from "embedded-postgres";
import { mkdtempSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { reserveForRun } from "@/billing/db";
import { applyStaticChecks, checkLeadEmails, emailCheckSummary, emailCheckTick, excludeRisky, includeExcluded, lookupDomains } from "@/lib/email-check-pg";
import { fakeResolver } from "@/lib/email-dns";
import { DEFAULT_WINDOW } from "@/lib/sender/schedule";
import { createInbox, senderNext, startSending } from "@/sender/db";
import { freePort } from "./free-port";

const root = path.resolve(__dirname, "..");
const USER = "00000000-0000-4000-8000-0000000000ec";
let server: EmbeddedPostgres;
let pool: pg.Pool;
let dir: string;
let ws: string;

beforeAll(async () => {
  dir = mkdtempSync(path.join(tmpdir(), "firstline-emailcheck-"));
  const port = await freePort();
  server = new EmbeddedPostgres({ databaseDir: dir, user: "postgres", password: "test", port, persistent: false, onLog: () => {} });
  await server.initialise();
  await server.start();
  pool = new pg.Pool({ host: "127.0.0.1", port, user: "postgres", password: "test", database: "postgres", max: 10 });
  await pool.query(readFileSync(path.join(root, "tests/supabase-shim.sql"), "utf8"));
  for (const f of readdirSync(path.join(root, "migrations")).filter((f) => f.endsWith(".sql")).sort()) {
    await pool.query(readFileSync(path.join(root, "migrations", f), "utf8"));
  }
  await pool.query("insert into auth.users (id, email, email_confirmed_at) values ($1, 'me@check.nl', now())", [USER]);
  ws = (await pool.query("select id from public.workspaces where owner_id = $1", [USER])).rows[0].id;
  await pool.query("select public.add_purchase($1, 100, 'test:emailcheck', 'test credits', 'standard')", [ws]);
}, 120_000);

afterAll(async () => {
  await pool?.end();
  await server?.stop();
  rmSync(dir, { recursive: true, force: true });
});

const dns = () =>
  fakeResolver({
    "acme.nl": { mx: ["mx.acme.nl"] },
    "gmail.com": { mx: ["gmail-smtp-in.l.google.com"] },
    "webonly.nl": { a: ["192.0.2.1"] },
    "nomail.nl": { mx: "." },
  });

async function campaign(emails: string[]) {
  const c = (await pool.query("insert into public.campaigns (workspace_id, name) values ($1, 'Check') returning id", [ws])).rows[0].id as string;
  const leads: { id: string; email: string }[] = [];
  for (const email of emails) {
    const id = (await pool.query("insert into public.leads (workspace_id, campaign_id, email, first_name, domain) values ($1, $2, $3, 'X', 'acme.nl') returning id", [ws, c, email])).rows[0].id;
    leads.push({ id, email });
  }
  return { id: c, leads };
}
const lead = (email: string) => pool.query("select status, status_detail, email_status, email_reason, email_reasons, email_suggestion from public.leads where email = $1 order by created_at desc limit 1", [email]).then((r) => r.rows[0]);
const balance = () => pool.query("select available, reserved from public.workspace_balance where workspace_id = $1", [ws]).then((r) => r.rows[0]);

describe("email checks (database)", () => {
  it("domains are looked up once and cached for 7 days; failed lookups retry after an hour", async () => {
    const r = dns();
    const now = new Date("2026-11-27T10:00:00Z");
    const first = await lookupDomains(pool, r, ["acme.nl", "webonly.nl", "gone.nl"], { now });
    expect(Object.fromEntries(first)).toEqual({ "acme.nl": "mx", "webonly.nl": "a_only", "gone.nl": "none" });
    const calls = r.calls.length;
    await lookupDomains(pool, r, ["acme.nl", "gone.nl"], { now: new Date(now.getTime() + 6 * 86_400_000) });
    expect(r.calls.length).toBe(calls); // from the cache
    await lookupDomains(pool, r, ["acme.nl"], { now: new Date(now.getTime() + 8 * 86_400_000) });
    expect(r.calls.length).toBeGreaterThan(calls); // stale: looked up again
  });

  it("static checks at import skip invalid addresses at once; DNS in the worker settles the rest", async () => {
    const c = await campaign(["sanne@acme.nl", "info@acme.nl", "piet@gmial.com", "temp@mailinator.com", "a@webonly.nl", "b@nomail.nl", "c@gone.nl", "d@gmail.com"]);
    await applyStaticChecks(pool, c.leads);
    expect(await lead("temp@mailinator.com")).toMatchObject({ status: "skipped", email_status: "invalid", email_reason: "disposable", status_detail: "Invalid email: throwaway email domain" });
    expect(await lead("info@acme.nl")).toMatchObject({ status: "queued", email_status: "pending", email_reasons: ["role"] });
    expect(await lead("piet@gmial.com")).toMatchObject({ email_suggestion: "piet@gmail.com" });

    await checkLeadEmails(pool, dns(), { campaignId: c.id });
    expect(await lead("sanne@acme.nl")).toMatchObject({ email_status: "valid", status: "queued" });
    expect(await lead("info@acme.nl")).toMatchObject({ email_status: "risky", email_reason: "role" });
    expect(await lead("a@webonly.nl")).toMatchObject({ email_status: "risky", email_reason: "a_only" });
    expect(await lead("b@nomail.nl")).toMatchObject({ email_status: "invalid", email_reason: "null_mx", status: "skipped" });
    expect(await lead("c@gone.nl")).toMatchObject({ email_status: "invalid", email_reason: "no_dns", status: "skipped" });
    expect(await lead("d@gmail.com")).toMatchObject({ email_status: "risky", email_reason: "personal" });
    // gmial.com is on the throwaway list itself; the typo suggestion stays, the address is never changed.
    expect(await lead("piet@gmial.com")).toMatchObject({ email_status: "invalid", email_reason: "disposable", email_suggestion: "piet@gmail.com" });

    const s = await emailCheckSummary(pool, ws, c.id);
    expect(s.byStatus).toEqual({ pending: 0, valid: 1, risky: 3, invalid: 4 });
    expect(s.suggestions).toEqual([{ email: "piet@gmial.com", suggestion: "piet@gmail.com" }]);
  });

  it("an address found invalid after the run started gets its reserved credit back", async () => {
    const c = await campaign(["late@gone.nl", "fine@acme.nl"]);
    await reserveForRun(pool, { workspaceId: ws, leadIds: c.leads.map((l) => l.id), perLead: 1 });
    const before = await balance();
    await checkLeadEmails(pool, dns(), { leadIds: c.leads.map((l) => l.id) });
    const after = await balance();
    expect(after.reserved).toBe(before.reserved - 1);
    expect(after.available).toBe(before.available + 1);
    expect(await lead("late@gone.nl")).toMatchObject({ status: "skipped", email_status: "invalid" });
  });

  it("exclude all risky / one reason, and include them again (never invalid ones)", async () => {
    const c = await campaign(["info@acme.nl", "e@gmail.com", "ok@acme.nl", "x@gone.nl"]);
    await checkLeadEmails(pool, dns(), { campaignId: c.id });
    expect(await excludeRisky(pool, ws, c.id, "personal")).toBe(1);
    expect(await lead("e@gmail.com")).toMatchObject({ status: "skipped", status_detail: "Excluded: personal" });
    expect(await lead("info@acme.nl")).toMatchObject({ status: "queued" });
    expect(await excludeRisky(pool, ws, c.id, null)).toBe(1);
    expect((await emailCheckSummary(pool, ws, c.id)).excluded).toBe(2);
    expect(await excludeRisky(pool, "00000000-0000-4000-8000-000000000000", c.id, null)).toBe(0); // another workspace
    expect(await includeExcluded(pool, ws, c.id)).toBe(2);
    expect(await lead("x@gone.nl")).toMatchObject({ status: "skipped", email_status: "invalid" });
  });

  it("the worker's round checks new leads, and the sending lanes refuse an address that turned invalid", async () => {
    const c = await campaign(["send@acme.nl", "dies@acme.nl"]);
    await pool.query("update public.leads set status = 'done' where campaign_id = $1", [c.id]);
    for (const l of c.leads) {
      await pool.query("insert into public.generations (lead_id, workspace_id, subject, full_email, slot_outputs) values ($1, $2, 'Hi', 'Hello', '{}')", [l.id, ws]);
    }
    expect((await emailCheckTick(pool, dns())).checked).toBeGreaterThanOrEqual(2);
    const { id: inboxId, key } = await createInbox(pool, { workspaceId: ws, email: "out@check.nl", window: DEFAULT_WINDOW, dailyCap: 30 });
    await startSending(pool, { workspaceId: ws, campaignId: c.id, inboxIds: [inboxId], optOutLine: null });
    // "dies@acme.nl" turns out invalid before it's sent (e.g. at the 7-day re-check).
    await pool.query("update public.leads set email_status = 'invalid', email_reason = 'no_dns' where email = 'dies@acme.nl'");
    const wednesday = new Date("2026-11-25T09:00:00Z");
    const next = await senderNext(pool, key, { scriptVersion: "1.2.0", now: wednesday });
    expect(next.email?.to).toBe("send@acme.nl");
    const refused = (await pool.query("select status, status_detail from public.sends where to_email = 'dies@acme.nl'")).rows[0];
    expect(refused).toEqual({ status: "stopped", status_detail: "Invalid email: no_dns" });
  });

  it("the pre-send re-check: a queued first email whose check is older than 7 days is checked again", async () => {
    const c = await campaign(["old@stale.nl"]);
    await pool.query("update public.leads set status = 'done', email_status = 'valid', email_checked_at = now() - interval '10 days' where campaign_id = $1", [c.id]);
    await pool.query("insert into public.generations (lead_id, workspace_id, subject, full_email, slot_outputs) values ($1, $2, 'Hi', 'Hello', '{}')", [c.leads[0].id, ws]);
    const { id: inboxId } = await createInbox(pool, { workspaceId: ws, email: "out2@check.nl", window: DEFAULT_WINDOW, dailyCap: 30 });
    await startSending(pool, { workspaceId: ws, campaignId: c.id, inboxIds: [inboxId], optOutLine: null });
    // The domain stopped accepting mail since the first check.
    await emailCheckTick(pool, fakeResolver({ "stale.nl": { mx: "." } }), { now: new Date() });
    expect(await lead("old@stale.nl")).toMatchObject({ email_status: "invalid", email_reason: "null_mx" });
  });
});
