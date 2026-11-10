// Integration: the Gmail sender API data layer on a real Postgres 17 (embedded).
// next → sent → gap → next, reply/bounce stop rules, same-domain pause, limits, races.
import EmbeddedPostgres from "embedded-postgres";
import { mkdtempSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { DEFAULT_WINDOW } from "@/lib/sender/schedule";
import {
  createInbox,
  resumeSend,
  rotateInboxKey,
  SenderAuthError,
  senderNext,
  senderReport,
  SENDER_SCRIPT_VERSION,
  setCampaignSendState,
  setInboxPaused,
  startSending,
} from "@/sender/db";

const root = path.resolve(__dirname, "..");
const USER = "00000000-0000-0000-0000-0000000000ee";
const V = SENDER_SCRIPT_VERSION;
const MON_10 = new Date("2026-11-09T09:00:00Z"); // Monday 10:00 Amsterdam
const at = (min: number) => new Date(MON_10.getTime() + min * 60_000);

let server: EmbeddedPostgres;
let pool: pg.Pool;
let dir: string;
let ws: string;

async function campaign(name: string, leads: [email: string, domain: string | null, status: string][], sendFallbacks = true) {
  const c = (await pool.query("insert into public.campaigns (workspace_id, name, send_fallbacks) values ($1, $2, $3) returning id", [ws, name, sendFallbacks]))
    .rows[0].id as string;
  const ids: string[] = [];
  for (const [email, domain, status] of leads) {
    const id = (
      await pool.query(
        "insert into public.leads (workspace_id, campaign_id, email, first_name, company, domain, status) values ($1, $2, $3, 'X', 'Co', $4, $5) returning id",
        [ws, c, email, domain, status],
      )
    ).rows[0].id;
    await pool.query(
      "insert into public.generations (lead_id, workspace_id, subject, full_email, slot_outputs) values ($1, $2, $3, $4, '{}')",
      [id, ws, `Idea for ${email}`, `Hi X,\n\nEmail for ${email}.\n\nBest`],
    );
    ids.push(id);
  }
  return { id: c, leads: ids };
}

beforeAll(async () => {
  dir = mkdtempSync(path.join(tmpdir(), "firstline-send-"));
  const port = 52_000 + Math.floor(Math.random() * 4_000);
  server = new EmbeddedPostgres({ databaseDir: dir, user: "postgres", password: "test", port, persistent: false, onLog: () => {} });
  await server.initialise();
  await server.start();
  pool = new pg.Pool({ host: "127.0.0.1", port, user: "postgres", password: "test", database: "postgres", max: 10 });
  await pool.query(readFileSync(path.join(root, "tests/supabase-shim.sql"), "utf8"));
  for (const f of readdirSync(path.join(root, "migrations")).filter((f) => f.endsWith(".sql")).sort()) {
    await pool.query(readFileSync(path.join(root, "migrations", f), "utf8"));
  }
  await pool.query("insert into auth.users (id, email) values ($1, 'me@sender.nl')", [USER]);
  ws = (await pool.query("select id from public.workspaces where owner_id = $1", [USER])).rows[0].id;
}, 120_000);

afterAll(async () => {
  await pool?.end();
  await server?.stop();
  rmSync(dir, { recursive: true, force: true });
});

describe("Gmail sender API", () => {
  let key: string;
  let inbox: string;
  let camp: { id: string; leads: string[] };

  it("creates an inbox with a key that is only stored as a hash", async () => {
    ({ id: inbox, key } = await createInbox(pool, { workspaceId: ws, email: "Me@Sender.nl", window: DEFAULT_WINDOW, dailyCap: 30 }));
    const row = (await pool.query("select email, sender_key_hash, key_prefix from public.inboxes where id = $1", [inbox])).rows[0];
    expect(row.email).toBe("me@sender.nl");
    expect(row.sender_key_hash).toMatch(/^[0-9a-f]{64}$/);
    expect(row.sender_key_hash).not.toContain(key);
    await expect(senderNext(pool, "fl_wrong", { scriptVersion: V, now: MON_10 })).rejects.toBeInstanceOf(SenderAuthError);
  });

  it("queues finished leads with the opt-out line; skips fallbacks when the campaign says so", async () => {
    camp = await campaign("A", [
      ["anna@acme.nl", "acme.nl", "done"],
      ["bob@other.nl", "other.nl", "fallback"],
      ["carl@acme.nl", "acme.nl", "done"],
      ["dave@failed.nl", "failed.nl", "failed"],
    ]);
    const r = await startSending(pool, { workspaceId: ws, campaignId: camp.id, inboxIds: [inbox], optOutLine: "Not relevant? Just reply 'no'." });
    expect(r).toMatchObject({ queued: 3, suppressed: 0, alreadyQueued: 0, skippedFallbacks: 0, followUps: 0 });
    const body = (await pool.query("select body from public.sends where lead_id = $1", [camp.leads[0]])).rows[0].body;
    expect(body).toBe("Hi X,\n\nEmail for anna@acme.nl.\n\nBest\n\nNot relevant? Just reply 'no'.");
    // Starting again doesn't double-queue.
    expect(await startSending(pool, { workspaceId: ws, campaignId: camp.id, inboxIds: [inbox], optOutLine: null })).toMatchObject({ queued: 0, alreadyQueued: 3 });

    const noFallbacks = await campaign("B", [["eve@b.nl", "b.nl", "fallback"], ["fay@b2.nl", "b2.nl", "done"]], false);
    expect(await startSending(pool, { workspaceId: ws, campaignId: noFallbacks.id, inboxIds: [inbox], optOutLine: null })).toMatchObject({ queued: 1, skippedFallbacks: 1 });
    await setCampaignSendState(pool, ws, noFallbacks.id, "paused");
  });

  it("peek (Connect / paused sheet) records the heartbeat but hands nothing out", async () => {
    const p = await senderNext(pool, key, { scriptVersion: V, now: MON_10, peek: true });
    expect(p.email).toBeNull();
    expect(p.wait?.label).toBe("Connected");
    expect((await pool.query("select last_heartbeat_at, script_version from public.inboxes where id = $1", [inbox])).rows[0]).toMatchObject({
      last_heartbeat_at: MON_10,
      script_version: V,
    });
  });

  it("hands out one email, waits for its report, then keeps a random 6–14 min gap", async () => {
    const n1 = await senderNext(pool, key, { scriptVersion: V, now: MON_10 });
    expect(n1.email).toMatchObject({ to: "anna@acme.nl", subject: "Idea for anna@acme.nl" });
    expect(n1.inbox).toMatchObject({ sent_today: 0, cap: 10 }); // warm-up day 0
    expect(n1.rules.unsubscribe).toBeTruthy();

    // Not reported yet → nothing else goes out.
    expect((await senderNext(pool, key, { scriptVersion: V, now: at(1) })).wait?.reason).toBe("too_soon");

    const rep = await senderReport(pool, key, { send: { send_id: n1.email!.send_id, status: "sent", thread_id: "t-anna" } }, { now: at(1), random: () => 0 });
    expect(rep.sent).toBe(1);
    // Reporting twice is harmless.
    expect((await senderReport(pool, key, { send: { send_id: n1.email!.send_id, status: "sent", thread_id: "t-anna" } }, { now: at(1) })).sent).toBe(0);

    expect((await senderNext(pool, key, { scriptVersion: V, now: at(5) })).wait?.reason).toBe("too_soon"); // gap = 6 min
    const n2 = await senderNext(pool, key, { scriptVersion: V, now: at(8) });
    expect(n2.email?.to).toBe("bob@other.nl");
    expect(n2.inbox.sent_today).toBe(1);
    expect(n2.watch).toEqual([{ send_id: n1.email!.send_id, thread_id: "t-anna" }]);
    await senderReport(pool, key, { send: { send_id: n2.email!.send_id, status: "sent", thread_id: "t-bob" } }, { now: at(8), random: () => 0 });
  });

  it("a reply stops the lead, suppresses the address and pauses colleagues at the same domain (resumable)", async () => {
    const anna = (await pool.query("select id from public.sends where lead_id = $1", [camp.leads[0]])).rows[0].id;
    const rep = await senderReport(pool, key, { events: [{ send_id: anna, type: "replied" }] }, { now: at(20) });
    expect(rep).toMatchObject({ replied: 1, paused_same_domain: 1 });

    const carl = (await pool.query("select id, status, status_detail from public.sends where lead_id = $1", [camp.leads[2]])).rows[0];
    expect(carl).toMatchObject({ status: "paused", status_detail: "Colleague at acme.nl replied" });
    expect((await pool.query("select reason from public.suppression where email = 'anna@acme.nl'")).rows).toEqual([{ reason: "replied" }]);

    // The paused colleague isn't handed out.
    expect((await senderNext(pool, key, { scriptVersion: V, now: at(30) })).wait?.reason).toBe("nothing_queued");
    // …until the user resumes them.
    expect(await resumeSend(pool, ws, carl.id)).toBe(true);
    expect((await senderNext(pool, key, { scriptVersion: V, now: at(31) })).email?.to).toBe("carl@acme.nl");
  });

  it("'unsubscribe' and bounces suppress the address with the right reason", async () => {
    const bob = (await pool.query("select id from public.sends where lead_id = $1", [camp.leads[1]])).rows[0].id;
    await senderReport(pool, key, { events: [{ send_id: bob, type: "replied", unsubscribe: true }] }, { now: at(40) });
    expect((await pool.query("select reason from public.suppression where email = 'bob@other.nl'")).rows).toEqual([{ reason: "unsub" }]);
    expect((await pool.query("select status_detail from public.sends where id = $1", [bob])).rows[0].status_detail).toBe("Asked to stop");

    const carl = (await pool.query("select id from public.sends where lead_id = $1", [camp.leads[2]])).rows[0].id;
    await senderReport(pool, key, { send: { send_id: carl, status: "sent", thread_id: "t-carl" } }, { now: at(41) });
    expect((await senderReport(pool, key, { events: [{ send_id: carl, type: "bounced" }] }, { now: at(50) })).bounced).toBe(1);
    expect((await pool.query("select reason from public.suppression where email = 'carl@acme.nl'")).rows).toEqual([{ reason: "bounce" }]);
  });

  it("a suppressed address is never sent, even if it was queued before", async () => {
    const c = await campaign("C", [["anna@acme.nl", "acme.nl", "done"]]); // replied earlier
    expect(await startSending(pool, { workspaceId: ws, campaignId: c.id, inboxIds: [inbox], optOutLine: null })).toMatchObject({ queued: 0, suppressed: 1 });
  });

  it("a reply from a free-mail address doesn't pause other gmail.com leads", async () => {
    const c = await campaign("D", [["jan@gmail.com", null, "done"], ["piet@gmail.com", null, "done"]]);
    await startSending(pool, { workspaceId: ws, campaignId: c.id, inboxIds: [inbox], optOutLine: null });
    const n = await senderNext(pool, key, { scriptVersion: V, now: at(120) });
    expect(n.email?.to).toBe("jan@gmail.com");
    await senderReport(pool, key, { send: { send_id: n.email!.send_id, status: "sent", thread_id: "t-jan" } }, { now: at(120) });
    expect((await senderReport(pool, key, { events: [{ send_id: n.email!.send_id, type: "replied" }] }, { now: at(121) })).paused_same_domain).toBe(0);
    const piet = (await pool.query("select s.status from public.sends s join public.leads l on l.id = s.lead_id where l.email = 'piet@gmail.com'")).rows[0];
    expect(piet.status).toBe("queued");
  });

  it("respects the window, the daily cap, pause, the admin switch and old scripts", async () => {
    expect((await senderNext(pool, key, { scriptVersion: V, now: new Date("2026-11-14T11:00:00Z") })).wait?.reason).toBe("outside_window");

    await pool.query("update public.inboxes set daily_cap = 3 where id = $1", [inbox]); // 3 sent today already
    expect((await senderNext(pool, key, { scriptVersion: V, now: at(200) })).wait?.reason).toBe("daily_cap");
    await pool.query("update public.inboxes set daily_cap = 30 where id = $1", [inbox]);

    await setInboxPaused(pool, ws, inbox, true);
    expect((await senderNext(pool, key, { scriptVersion: V, now: at(201) })).wait?.reason).toBe("paused");
    await setInboxPaused(pool, ws, inbox, false);

    await pool.query("update public.workspaces set sender_disabled = true where id = $1", [ws]);
    expect((await senderNext(pool, key, { scriptVersion: V, now: at(202) })).wait?.reason).toBe("sender_disabled");
    await pool.query("update public.workspaces set sender_disabled = false where id = $1", [ws]);

    const old = await senderNext(pool, key, { scriptVersion: "0.9.0", now: at(203) });
    expect(old.script.update_required).toBe(true);
    expect(old.email).toBeNull();
  });

  it("two script runs at the same moment never get the same email", async () => {
    const c = await campaign("E", [["r1@race.nl", "race.nl", "done"], ["r2@race2.nl", "race2.nl", "done"]]);
    await startSending(pool, { workspaceId: ws, campaignId: c.id, inboxIds: [inbox], optOutLine: null });
    await pool.query("update public.inboxes set next_send_at = null where id = $1", [inbox]);
    const [a, b] = await Promise.all([
      senderNext(pool, key, { scriptVersion: V, now: at(300) }),
      senderNext(pool, key, { scriptVersion: V, now: at(300) }),
    ]);
    expect([a.email, b.email].filter(Boolean)).toHaveLength(1);
  });

  it("warm-up steps up one day after a day with sends", async () => {
    const tue = new Date("2026-11-10T09:00:00Z");
    const n = await senderNext(pool, key, { scriptVersion: V, now: tue });
    expect(n.inbox.cap).toBe(12); // day 1
    expect((await pool.query("select warmup_day from public.inboxes where id = $1", [inbox])).rows[0].warmup_day).toBe(1);
  });

  it("adding an existing address updates its settings, unpauses it and gives a new key", async () => {
    await setInboxPaused(pool, ws, inbox, true);
    const again = await createInbox(pool, { workspaceId: ws, email: "me@sender.nl", window: { ...DEFAULT_WINDOW, start: "00:00", end: "23:59" }, dailyCap: 20 });
    expect(again).toMatchObject({ id: inbox, updated: true });
    const row = (await pool.query(`select daily_cap, "window"->>'start' start, health from public.inboxes where id = $1`, [inbox])).rows[0];
    expect(row).toEqual({ daily_cap: 20, start: "00:00", health: "warming" });
    key = again.key;
  });

  it("rotating the key locks out the old one", async () => {
    const fresh = await rotateInboxKey(pool, ws, inbox);
    expect(fresh).toBeTruthy();
    await expect(senderNext(pool, key, { scriptVersion: V, now: at(400) })).rejects.toBeInstanceOf(SenderAuthError);
    await expect(senderNext(pool, fresh!, { scriptVersion: V, now: at(400) })).resolves.toBeTruthy();
  });
});

describe("3-step sequence across 2 inboxes (Phase 4)", () => {
  it("spreads leads over the inboxes, follows up in the same thread after the delay, and stops on a reply", async () => {
    const a = await createInbox(pool, { workspaceId: ws, email: "a@sender.nl", window: DEFAULT_WINDOW, dailyCap: 30 });
    const b = await createInbox(pool, { workspaceId: ws, email: "b@sender.nl", window: DEFAULT_WINDOW, dailyCap: 30 });
    const c = await campaign("Seq", [["one@seq1.nl", "seq1.nl", "done"], ["two@seq2.nl", "seq2.nl", "done"]]);
    await pool.query(
      `insert into public.sequence_steps (campaign_id, workspace_id, step_no, delay_days, kind, template_body) values
         ($1, $2, 2, 0, 'plain', 'Hi {{first_name}}, a quick follow-up.'),
         ($1, $2, 3, 2, 'personalised', 'Hi {{first_name}}, [[angle · another fact · 20]]')`,
      [c.id, ws],
    );
    // Step 3 was written for the first lead only (e.g. the second was written before the step existed).
    await pool.query("insert into public.generations (lead_id, workspace_id, step_no, subject, full_email, slot_outputs) values ($1, $2, 3, '', 'Hi X, saw your new office.', '{}')", [
      c.leads[0],
      ws,
    ]);

    const r = await startSending(pool, { workspaceId: ws, campaignId: c.id, inboxIds: [a.id, b.id], optOutLine: null });
    expect(r).toMatchObject({ queued: 2, followUps: 3, missingFollowUps: 1 });
    const { rows: plan } = await pool.query(
      `select l.email, s.step_no, i.email inbox, s.subject, s.body from public.sends s join public.leads l on l.id = s.lead_id
         join public.inboxes i on i.id = s.inbox_id where s.campaign_id = $1 order by l.email, s.step_no`,
      [c.id],
    );
    expect(plan.map((p) => `${p.email} ${p.step_no} ${p.inbox}`)).toEqual([
      "one@seq1.nl 1 a@sender.nl",
      "one@seq1.nl 2 a@sender.nl",
      "one@seq1.nl 3 a@sender.nl",
      "two@seq2.nl 1 b@sender.nl",
      "two@seq2.nl 2 b@sender.nl",
    ]);
    expect(plan[1]).toMatchObject({ subject: "Re: Idea for one@seq1.nl", body: "Hi X, a quick follow-up." });

    // Inbox b only ever gets lead two.
    expect((await senderNext(pool, b.key, { scriptVersion: V, now: MON_10 })).email?.to).toBe("two@seq2.nl");

    // Inbox a: step 1, then (after the gap) step 2 in the same thread, then step 3 two working days later.
    const s1 = (await senderNext(pool, a.key, { scriptVersion: V, now: MON_10 })).email!;
    expect(s1).toMatchObject({ to: "one@seq1.nl", thread_id: null });
    await senderReport(pool, a.key, { send: { send_id: s1.send_id, status: "sent", thread_id: "t-one" } }, { now: MON_10, random: () => 0 });
    expect((await senderNext(pool, a.key, { scriptVersion: V, now: at(3) })).wait?.reason).toBe("too_soon");

    const s2 = (await senderNext(pool, a.key, { scriptVersion: V, now: at(10) })).email!;
    expect(s2).toMatchObject({ to: "one@seq1.nl", subject: "Re: Idea for one@seq1.nl", thread_id: "t-one" });
    await senderReport(pool, a.key, { send: { send_id: s2.send_id, status: "sent", thread_id: "t-one" } }, { now: at(10), random: () => 0 });

    const n = await senderNext(pool, a.key, { scriptVersion: V, now: at(30) });
    expect(n.wait?.reason).toBe("nothing_queued"); // step 3 isn't due until Wednesday
    expect(n.watch).toEqual([{ send_id: s2.send_id, thread_id: "t-one" }]); // one entry per thread: the latest step

    const wed = new Date("2026-11-11T09:00:00Z");
    const s3 = (await senderNext(pool, a.key, { scriptVersion: V, now: wed })).email!;
    expect(s3).toMatchObject({ thread_id: "t-one", body: "Hi X, saw your new office." });
    await senderReport(pool, a.key, { send: { send_id: s3.send_id, status: "sent", thread_id: "t-one" } }, { now: wed });

    // A reply ends the lead; its thread is no longer watched.
    await senderReport(pool, a.key, { events: [{ send_id: s3.send_id, type: "replied" }] }, { now: new Date(wed.getTime() + 3600_000) });
    expect((await senderNext(pool, a.key, { scriptVersion: V, now: new Date(wed.getTime() + 7200_000) })).watch).toEqual([]);
  });

  it("an old 1.0.0 script (can't reply in a thread) only gets first emails", async () => {
    const y = await createInbox(pool, { workspaceId: ws, email: "y@sender.nl", window: DEFAULT_WINDOW, dailyCap: 30 });
    const c = await campaign("Seq-old", [["old@seq4.nl", "seq4.nl", "done"]]);
    await pool.query("insert into public.sequence_steps (campaign_id, workspace_id, step_no, delay_days, kind, template_body) values ($1, $2, 2, 0, 'plain', 'Bump')", [c.id, ws]);
    await startSending(pool, { workspaceId: ws, campaignId: c.id, inboxIds: [y.id], optOutLine: null });
    const s1 = (await senderNext(pool, y.key, { scriptVersion: "1.0.0", now: MON_10 })).email!;
    await senderReport(pool, y.key, { send: { send_id: s1.send_id, status: "sent", thread_id: "t-old" } }, { now: MON_10, random: () => 0 });
    const old = await senderNext(pool, y.key, { scriptVersion: "1.0.0", now: at(20) });
    expect(old.email).toBeNull();
    expect(old.script.latest).toBe(V); // the sheet shows "newer version available"
    expect((await senderNext(pool, y.key, { scriptVersion: V, now: at(21) })).email?.thread_id).toBe("t-old");
  });

  it("a reply to step 1 stops the follow-ups that haven't gone out", async () => {
    const x = await createInbox(pool, { workspaceId: ws, email: "x@sender.nl", window: DEFAULT_WINDOW, dailyCap: 30 });
    const c = await campaign("Seq2", [["stop@seq3.nl", "seq3.nl", "done"]]);
    await pool.query("insert into public.sequence_steps (campaign_id, workspace_id, step_no, delay_days, kind, template_body) values ($1, $2, 2, 3, 'plain', 'Any thoughts?')", [c.id, ws]);
    await startSending(pool, { workspaceId: ws, campaignId: c.id, inboxIds: [x.id], optOutLine: null });
    const s1 = (await senderNext(pool, x.key, { scriptVersion: V, now: MON_10 })).email!;
    await senderReport(pool, x.key, { send: { send_id: s1.send_id, status: "sent", thread_id: "t-stop" } }, { now: MON_10 });
    expect((await pool.query("select scheduled_for from public.sends where lead_id = $1 and step_no = 2", [c.leads[0]])).rows[0].scheduled_for).toEqual(
      new Date("2026-11-11T23:00:00Z"), // Monday + 3 working days = Thursday 00:00 Amsterdam
    );
    await senderReport(pool, x.key, { events: [{ send_id: s1.send_id, type: "replied" }] }, { now: at(60) });
    expect((await pool.query("select status, status_detail from public.sends where lead_id = $1 and step_no = 2", [c.leads[0]])).rows[0]).toEqual({
      status: "stopped",
      status_detail: "Lead replied",
    });
  });
});
