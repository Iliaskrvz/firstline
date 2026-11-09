// Runs the real Code.gs in a sandbox with fake Google services, so the script's
// logic is tested without a Google account.
import { readFileSync } from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { describe, expect, it } from "vitest";
import { BOUNCE_SENDER_PATTERN, isUnsubscribeReply, REPLY_CUT_PATTERN, UNSUBSCRIBE_PATTERN } from "@/lib/sender/messages";
import { SENDER_SCRIPT_VERSION } from "@/sender/db";

const CODE = readFileSync(path.join(__dirname, "Code.gs"), "utf8");
const RULES = { unsubscribe: UNSUBSCRIBE_PATTERN, reply_cut: REPLY_CUT_PATTERN, bounce_from: BOUNCE_SENDER_PATTERN };

type Msg = { from: string; body: string };

function sandbox(opts: { threads?: Record<string, Msg[]>; paused?: boolean; next?: object; me?: string } = {}) {
  const calls: { method: string; path: string; headers: Record<string, string>; payload?: unknown }[] = [];
  const sent: { to: string; subject: string; body: string }[] = [];
  const logs: unknown[][] = [];
  const cells: Record<string, unknown> = { B4: opts.paused ?? false };
  const sheet = {
    getRange: (a: string) => ({
      getValue: () => cells[a],
      setValue: (v: unknown) => ((cells[a] = v), sheetRange),
      setValues: () => sheetRange,
      setFontWeight: () => sheetRange,
      setFontSize: () => sheetRange,
      setFontColor: () => sheetRange,
      insertCheckboxes: () => sheetRange,
    }),
    appendRow: (row: unknown[]) => logs.push(row),
    getLastRow: () => logs.length + 1,
    deleteRows: () => {},
    setColumnWidth: () => {},
    setFrozenRows: () => {},
  };
  const sheetRange = sheet.getRange("x");
  const thread = (id: string) => ({
    getId: () => id,
    getMessages: () => (opts.threads?.[id] ?? []).map((m) => ({ getFrom: () => m.from, getPlainBody: () => m.body })),
  });
  const ctx: Record<string, unknown> = {
    console,
    PropertiesService: { getUserProperties: () => ({ getProperty: (k: string) => ({ FL_BASE: "https://fl.test", FL_KEY: "fl_" + "a".repeat(43) })[k] ?? null }) },
    LockService: { getScriptLock: () => ({ tryLock: () => true, releaseLock: () => {} }) },
    SpreadsheetApp: { getActiveSpreadsheet: () => ({ getSheetByName: () => sheet, insertSheet: () => sheet }) },
    Session: { getEffectiveUser: () => ({ getEmail: () => opts.me ?? "me@sender.nl" }) },
    GmailApp: {
      createDraft: (to: string, subject: string, body: string) => ({
        send: () => {
          sent.push({ to, subject, body });
          return { getThread: () => thread("t-new") };
        },
      }),
      getThreadById: (id: string) => (opts.threads && id in opts.threads ? thread(id) : null),
    },
    UrlFetchApp: {
      fetch: (url: string, o: { method: string; headers: Record<string, string>; payload?: string }) => {
        calls.push({ method: o.method, path: url.replace("https://fl.test", ""), headers: o.headers, payload: o.payload ? JSON.parse(o.payload) : undefined });
        const body = o.method === "get"
          ? { email: null, wait: { reason: "nothing_queued", label: "Nothing to send" }, watch: [], rules: RULES, script: { latest: SENDER_SCRIPT_VERSION, update_required: false }, inbox: { email: "me@sender.nl", sent_today: 0, cap: 10 }, ...opts.next }
          : { sent: 1 };
        return { getResponseCode: () => 200, getContentText: () => JSON.stringify(body) };
      },
    },
  };
  vm.createContext(ctx);
  vm.runInContext(CODE, ctx);
  return { ctx: ctx as Record<string, (...a: unknown[]) => unknown>, calls, sent, logs, cells };
}

describe("Code.gs", () => {
  it("has the version the server expects", () => {
    expect(CODE).toContain(`var FL_VERSION = '${SENDER_SCRIPT_VERSION}';`);
  });

  it("strips quoted text the same way as the server", () => {
    const { ctx } = sandbox();
    const cut = new RegExp(REPLY_CUT_PATTERN, "im");
    const unsub = new RegExp(UNSUBSCRIBE_PATTERN, "im");
    const quoted = "\n\nOn Mon, 9 Nov 2026 at 10:00, Me <me@sender.nl> wrote:\n> Not relevant? Just reply 'no'.";
    for (const reply of ["nee", "Sounds good, call me", "Please unsubscribe me", "No problem, next week works", "> no\nfine by me"]) {
      expect(unsub.test(ctx.flOwnText_(reply + quoted, cut) as string), reply).toBe(isUnsubscribeReply(reply + quoted));
    }
  });

  it("sends the email it is given, reports the thread, and logs it", () => {
    const s = sandbox({ next: { email: { send_id: "11111111-1111-4111-8111-111111111111", to: "anna@acme.nl", subject: "Hi", body: "Body", thread_id: null }, wait: null } });
    s.ctx.flRun();
    expect(s.sent).toEqual([{ to: "anna@acme.nl", subject: "Hi", body: "Body" }]);
    expect(s.calls.map((c) => `${c.method} ${c.path}`)).toEqual(["get /api/sender/next", "post /api/sender/report"]);
    expect(s.calls[0].headers).toMatchObject({ "X-FirstLine-Script": SENDER_SCRIPT_VERSION, "X-FirstLine-Peek": "0" });
    expect(s.calls[1].payload).toEqual({ send: { send_id: "11111111-1111-4111-8111-111111111111", status: "sent", thread_id: "t-new" } });
    expect(s.logs.at(-1)?.slice(1)).toEqual(["Sent", "anna@acme.nl", "Hi"]);
    expect(s.cells.B3).toBe("Sent 1 email");
  });

  it("reports replies (with the stop flag) and bounces, never the text", () => {
    const s = sandbox({
      threads: {
        "t-1": [{ from: "Me <me@sender.nl>", body: "our email" }, { from: "Anna <anna@acme.nl>", body: "Graag uitschrijven\n\nOp ma 9 nov schreef Me:\n> ..." }],
        "t-2": [{ from: "Me <me@sender.nl>", body: "our email" }, { from: "Mail Delivery Subsystem <mailer-daemon@googlemail.com>", body: "Address not found" }],
        "t-3": [{ from: "Me <me@sender.nl>", body: "our email" }],
        "t-4": [{ from: "Me <me@sender.nl>", body: "our email" }, { from: "Carl <carl@b.nl>", body: "Interesting, tell me more" }],
      },
      next: { watch: [{ send_id: "a", thread_id: "t-1" }, { send_id: "b", thread_id: "t-2" }, { send_id: "c", thread_id: "t-3" }, { send_id: "d", thread_id: "t-4" }, { send_id: "e", thread_id: "gone" }] },
    });
    s.ctx.flRun();
    expect(s.calls[1].payload).toEqual({
      events: [
        { send_id: "a", type: "replied", unsubscribe: true },
        { send_id: "b", type: "bounced" },
        { send_id: "d", type: "replied", unsubscribe: false },
      ],
    });
    expect(JSON.stringify(s.calls[1].payload)).not.toContain("tell me more");
  });

  it("when paused: heartbeat only (peek), still detects replies, sends nothing", () => {
    const s = sandbox({
      paused: true,
      threads: { "t-1": [{ from: "me@sender.nl", body: "x" }, { from: "anna@acme.nl", body: "yes!" }] },
      next: { watch: [{ send_id: "a", thread_id: "t-1" }], email: { send_id: "x", to: "z@z.nl", subject: "s", body: "b", thread_id: null } },
    });
    s.ctx.flRun();
    expect(s.calls[0].headers["X-FirstLine-Peek"]).toBe("1");
    expect(s.sent).toEqual([]);
    expect(s.calls[1].payload).toEqual({ events: [{ send_id: "a", type: "replied", unsubscribe: false }] });
    expect(String(s.cells.B3)).toMatch(/^Paused/);
  });

  it("a failed send is reported as failed, not lost", () => {
    const s = sandbox({ next: { email: { send_id: "f", to: "bad", subject: "s", body: "b", thread_id: null }, wait: null } });
    (s.ctx.GmailApp as unknown as { createDraft: () => never }).createDraft = () => {
      throw new Error("Invalid email: bad");
    };
    s.ctx.flRun();
    expect(s.calls[1].payload).toEqual({ send: { send_id: "f", status: "failed", error: "Invalid email: bad" } });
  });
});
