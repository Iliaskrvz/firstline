// The Outlook lane end to end on a real Postgres 17 (embedded) with the fake Microsoft 365: connect,
// send through the shared scheduler, threaded follow-up, reply and bounce detection, throttling,
// revoked access, and no double sends.
import EmbeddedPostgres from "embedded-postgres";
import { randomBytes } from "node:crypto";
import { mkdtempSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { startSending } from "@/sender/db";
import { FakeMicrosoft } from "@/sender/microsoft-fake";
import { alertDisconnected, connectOutlookInbox, disconnectOutlookInbox, outlookTick, REPLY_CHECK_MS, type OutlookDeps } from "@/sender/outlook";

const root = path.resolve(__dirname, "..");
const USER = "00000000-0000-4000-8000-0000000000aa";
const KEY = randomBytes(32);
const ME = "anna@contoso.com";
let server: EmbeddedPostgres;
let pool: pg.Pool;
let dir: string;
let ws: string;

// Wednesday 25 Nov 2026, 10:00 in Amsterdam: inside the default sending window.
let clock = new Date("2026-11-25T09:00:00Z");
const advance = (ms: number) => (clock = new Date(clock.getTime() + ms));

beforeAll(async () => {
  dir = mkdtempSync(path.join(tmpdir(), "firstline-outlook-"));
  const port = 65_500 + Math.floor(Math.random() * 30);
  server = new EmbeddedPostgres({ databaseDir: dir, user: "postgres", password: "test", port, persistent: false, onLog: () => {} });
  await server.initialise();
  await server.start();
  pool = new pg.Pool({ host: "127.0.0.1", port, user: "postgres", password: "test", database: "postgres", max: 10 });
  await pool.query(readFileSync(path.join(root, "tests/supabase-shim.sql"), "utf8"));
  for (const f of readdirSync(path.join(root, "migrations")).filter((f) => f.endsWith(".sql")).sort()) {
    await pool.query(readFileSync(path.join(root, "migrations", f), "utf8"));
  }
  await pool.query("insert into auth.users (id, email) values ($1, 'owner@us.nl')", [USER]);
  ws = (await pool.query("select id from public.workspaces where owner_id = $1", [USER])).rows[0].id;
}, 120_000);

afterAll(async () => {
  await pool?.end();
  await server?.stop();
  rmSync(dir, { recursive: true, force: true });
});

async function campaign(name: string, emails: string[], followUp = true) {
  const c = (await pool.query("insert into public.campaigns (workspace_id, name, send_fallbacks) values ($1, $2, true) returning id", [ws, name])).rows[0].id as string;
  for (const email of emails) {
    const id = (await pool.query("insert into public.leads (workspace_id, campaign_id, email, first_name, company, domain, status) values ($1, $2, $3, 'Lee', 'Co', $4, 'done') returning id", [ws, c, email, email.split("@")[1]])).rows[0].id;
    await pool.query("insert into public.generations (lead_id, workspace_id, subject, full_email, slot_outputs) values ($1, $2, $3, $4, '{}')", [id, ws, `Idea for ${email}`, `Hi Lee,\n\nEmail for ${email}.\n\nBest`]);
  }
  if (followUp) await pool.query("insert into public.sequence_steps (campaign_id, workspace_id, step_no, delay_days, kind, template_body) values ($1, $2, 2, 2, 'plain', 'Hi {{first_name}}, a quick follow-up.')", [c, ws]);
  return c;
}

const sends = (c: string) =>
  pool.query("select to_email, step_no, status, status_detail, gmail_thread_id, provider_message_id from public.sends where campaign_id = $1 order by to_email, step_no", [c]).then((r) => r.rows);

describe("Outlook lane", () => {
  const fake = new FakeMicrosoft({ now: () => clock });
  const deps = (): OutlookDeps => ({ pool, key: KEY, auth: fake.auth(), graph: (t) => fake.graph(t), now: () => clock, sleep: async () => {} });
  let inboxId: string;

  it("connecting stores the tokens encrypted and refuses an account without Mail.Send", async () => {
    await expect(connectOutlookInbox(pool, KEY, { workspaceId: ws, email: ME, tokens: await fake.auth().exchangeCode(FakeMicrosoft.code(ME, false), "v", "r") })).rejects.toThrow(/Mail\.Send/);
    const tokens = await fake.auth().exchangeCode(FakeMicrosoft.code(ME), "v", "r");
    inboxId = (await connectOutlookInbox(pool, KEY, { workspaceId: ws, email: ME, tokens })).inboxId;
    const cred = (await pool.query("select refresh_token_enc, scopes, tenant_id from public.inbox_credentials where inbox_id = $1", [inboxId])).rows[0];
    expect(cred.refresh_token_enc).toMatch(/^v1:/);
    expect(cred.refresh_token_enc).not.toContain(tokens.refreshToken);
    expect(cred.scopes).toContain("Mail.Send");
    expect((await pool.query("select type, health from public.inboxes where id = $1", [inboxId])).rows[0]).toEqual({ type: "outlook_oauth", health: "warming" });
  });

  it("sends step 1 through the shared scheduler (one at a time, with the random gap), and tracks the conversation", async () => {
    const c = await campaign("O1", ["one@lead1.com", "two@lead2.com"]);
    await startSending(pool, { workspaceId: ws, campaignId: c, inboxIds: [inboxId], optOutLine: "Not relevant? Reply 'no'." });
    expect(await outlookTick(deps())).toMatchObject({ inboxes: 1, sent: 1 });
    expect(await outlookTick(deps())).toMatchObject({ sent: 0 }); // the 6–14 minute gap
    advance(15 * 60_000);
    expect(await outlookTick(deps())).toMatchObject({ sent: 1 });
    const box = fake.boxes.get(ME)!;
    expect(box.sent.map((s) => s.to[0])).toEqual(["one@lead1.com", "two@lead2.com"]);
    expect(box.sent[0].text).toContain("Not relevant? Reply 'no'."); // same opt-out line as Gmail
    const rows = await sends(c);
    expect(rows.filter((r) => r.step_no === 1).every((r) => r.status === "sent" && r.gmail_thread_id && r.provider_message_id)).toBe(true);
    expect((await pool.query("select count(*)::int n from public.outcomes where channel = 'outlook' and status = 'sent'")).rows[0].n).toBe(2);
  });

  it("follow-ups are threaded replies from the same inbox, to the lead, after the delay", async () => {
    const box = fake.boxes.get(ME)!;
    const before = box.sent.length;
    advance(15 * 60_000);
    await outlookTick(deps());
    expect(box.sent.length).toBe(before); // 2 working days haven't passed
    advance(3 * 86_400_000); // Saturday 28 Nov, outside the window
    advance(2 * 86_400_000); // Monday 30 Nov, 10:30
    await outlookTick(deps());
    const followUp = box.sent[box.sent.length - 1];
    expect(fake.calls).toContain("reply");
    expect(followUp.to).toEqual(["one@lead1.com"]);
    expect(followUp.conversationId).toBe(box.sent.find((s) => s.to[0] === "one@lead1.com")!.conversationId);
  });

  it("a reply stops the lead and suppresses the address; out-of-office doesn't", async () => {
    const box = fake.boxes.get(ME)!;
    const conv2 = box.sent.find((s) => s.to[0] === "two@lead2.com")!.conversationId;
    fake.receive(ME, { from: "two@lead2.com", subject: "Automatic reply: Idea for two@lead2.com", conversationId: conv2 });
    advance(REPLY_CHECK_MS + 1);
    await outlookTick(deps());
    expect((await pool.query("select status from public.sends where to_email = 'two@lead2.com' and step_no = 1")).rows[0].status).toBe("sent");
    fake.receive(ME, { from: "two@lead2.com", subject: "RE: Idea for two@lead2.com", conversationId: conv2 });
    advance(REPLY_CHECK_MS + 1);
    await outlookTick(deps());
    // The follow-up had gone out by then, so the reply belongs to the latest email in the thread (as in the Gmail lane).
    const rows = (await pool.query("select step_no, status from public.sends where to_email = 'two@lead2.com' order by step_no")).rows;
    expect(rows).toEqual([{ step_no: 1, status: "sent" }, { step_no: 2, status: "replied" }]);
    expect((await pool.query("select reason from public.suppression where email = 'two@lead2.com'")).rows).toEqual([{ reason: "replied" }]);
  });

  it("a bounce (postmaster, own conversation, original subject) marks the email bounced", async () => {
    const c = await campaign("O2", ["bad@nowhere.example"], false);
    await startSending(pool, { workspaceId: ws, campaignId: c, inboxIds: [inboxId], optOutLine: null });
    advance(15 * 60_000);
    await outlookTick(deps());
    fake.receive(ME, { from: "postmaster@contoso.onmicrosoft.com", subject: "Undeliverable: Idea for bad@nowhere.example", conversationId: "ndr-conv-1" });
    advance(REPLY_CHECK_MS + 1);
    await outlookTick(deps());
    expect((await sends(c))[0]).toMatchObject({ status: "bounced" });
    expect((await pool.query("select reason from public.suppression where email = 'bad@nowhere.example'")).rows).toEqual([{ reason: "bounce" }]);
  });

  it("without our header in Sent Items it still finds the email by recipient and subject", async () => {
    fake.hideHeaders = true;
    const c = await campaign("O3", ["hidden@lead3.com"], false);
    await startSending(pool, { workspaceId: ws, campaignId: c, inboxIds: [inboxId], optOutLine: null });
    advance(15 * 60_000);
    await outlookTick(deps());
    expect((await sends(c))[0]).toMatchObject({ status: "sent" });
    expect((await sends(c))[0].provider_message_id).toBeTruthy();
    fake.hideHeaders = false;
  });

  it("throttling: the email goes back in the queue, no error counted, the inbox waits", async () => {
    const c = await campaign("O4", ["slow@lead4.com"], false);
    await startSending(pool, { workspaceId: ws, campaignId: c, inboxIds: [inboxId], optOutLine: null });
    advance(15 * 60_000);
    fake.throttle = { remaining: 10, retryAfterMs: 120_000 };
    await outlookTick(deps());
    expect((await sends(c))[0]).toMatchObject({ status: "queued" });
    const inbox = (await pool.query("select errors_today, next_send_at, handed_out_at from public.inboxes i, public.sends s where i.id = $1 and s.campaign_id = $2", [inboxId, c])).rows[0];
    expect(inbox.errors_today).toBe(0);
    expect(inbox.handed_out_at).toBeNull();
    expect(new Date(inbox.next_send_at).getTime()).toBeGreaterThanOrEqual(clock.getTime() + 120_000);
    fake.throttle = { remaining: 0, retryAfterMs: 0 };
    advance(3 * 60_000);
    await outlookTick(deps());
    expect((await sends(c))[0]).toMatchObject({ status: "sent" });
  });

  it("an email sent but never reported is not sent twice", async () => {
    const c = await campaign("O5", ["once@lead5.com"], false);
    await startSending(pool, { workspaceId: ws, campaignId: c, inboxIds: [inboxId], optOutLine: null });
    const send = (await pool.query("select id from public.sends where campaign_id = $1", [c])).rows[0].id;
    // As if a crashed run had already sent it.
    await fake.graph(`fake-at:${ME}`).sendMail({ to: "once@lead5.com", subject: "Idea for once@lead5.com", text: "x", sendId: send });
    const before = fake.boxes.get(ME)!.sent.length;
    advance(15 * 60_000);
    await outlookTick(deps());
    expect(fake.boxes.get(ME)!.sent.length).toBe(before);
    expect((await sends(c))[0]).toMatchObject({ status: "sent" });
  });

  it("revoked access: the inbox is marked disconnected, the owner gets one email, the worker keeps going", async () => {
    fake.revoke(ME);
    await pool.query("update public.inbox_credentials set access_expires_at = $2 where inbox_id = $1", [inboxId, clock]); // force a refresh
    const c = await campaign("O6", ["later@lead6.com"], false);
    await startSending(pool, { workspaceId: ws, campaignId: c, inboxIds: [inboxId], optOutLine: null });
    advance(15 * 60_000);
    expect(await outlookTick(deps())).toMatchObject({ disconnected: 1, sent: 0 });
    expect((await pool.query("select health, last_error from public.inboxes where id = $1", [inboxId])).rows[0]).toMatchObject({ health: "disconnected" });
    expect((await pool.query("select refresh_token_enc, disconnected_at from public.inbox_credentials where inbox_id = $1", [inboxId])).rows[0]).toMatchObject({ refresh_token_enc: null });
    expect(await outlookTick(deps())).toMatchObject({ inboxes: 0 }); // skipped from now on
    const sent: { to: string; subject: string }[] = [];
    const mailer = { send: async (m: { to: string; subject: string }) => void sent.push(m) };
    expect(await alertDisconnected(pool, mailer, "https://app.test")).toEqual([ME]);
    expect(await alertDisconnected(pool, mailer, "https://app.test")).toEqual([]); // once
    expect(sent).toEqual([expect.objectContaining({ to: "owner@us.nl", subject: `FirstLine: ${ME} is disconnected` })]);
    expect((await sends(c))[0]).toMatchObject({ status: "queued" }); // waits, nothing lost

    // Connecting again picks up where it stopped.
    await connectOutlookInbox(pool, KEY, { workspaceId: ws, email: ME, tokens: await fake.auth().exchangeCode(FakeMicrosoft.code(ME), "v", "r") });
    expect((await pool.query("select health from public.inboxes where id = $1", [inboxId])).rows[0].health).toBe("warming");
    advance(15 * 60_000);
    await outlookTick(deps());
    expect((await sends(c))[0]).toMatchObject({ status: "sent" });
  });

  it("disconnecting in FirstLine deletes the tokens at once; another workspace can't", async () => {
    expect(await disconnectOutlookInbox(pool, "00000000-0000-4000-8000-000000000000", inboxId)).toBe(false);
    expect(await disconnectOutlookInbox(pool, ws, inboxId)).toBe(true);
    expect((await pool.query("select count(*)::int n from public.inbox_credentials where inbox_id = $1", [inboxId])).rows[0].n).toBe(0);
    expect((await pool.query("select health from public.inboxes where id = $1", [inboxId])).rows[0].health).toBe("disconnected");
    expect(await outlookTick(deps())).toMatchObject({ inboxes: 0 });
  });
});
