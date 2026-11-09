import { describe, expect, it } from "vitest";
import {
  composeBody,
  defaultOptOutLine,
  generateSenderKey,
  hashSenderKey,
  isUnsubscribeReply,
  keyPrefix,
  looksLikeSenderKey,
  ownReplyText,
} from "./messages";
import {
  advanceWarmup,
  DEFAULT_WINDOW,
  effectiveCap,
  inboxHealth,
  inWindow,
  localTime,
  mayHandOut,
  nextGapMs,
  stepBack,
  validateWindow,
} from "./schedule";

// Monday 9 Nov 2026. Amsterdam is UTC+1 in November.
const MON_10_00_AMS = new Date("2026-11-09T09:00:00Z");
const MON_08_00_AMS = new Date("2026-11-09T07:00:00Z");
const MON_17_00_AMS = new Date("2026-11-09T16:00:00Z");
const SAT_12_00_AMS = new Date("2026-11-14T11:00:00Z");

describe("send window", () => {
  it("uses the inbox's timezone", () => {
    expect(localTime(MON_10_00_AMS, "Europe/Amsterdam")).toEqual({ date: "2026-11-09", weekday: 1, minutes: 600 });
    expect(localTime(new Date("2026-11-09T23:30:00Z"), "Europe/Amsterdam")).toMatchObject({ date: "2026-11-10", weekday: 2 });
    expect(localTime(MON_10_00_AMS, "America/New_York")).toMatchObject({ minutes: 240 });
  });

  it("is Mon–Fri 08:30–17:00 by default, end exclusive", () => {
    expect(inWindow(DEFAULT_WINDOW, MON_10_00_AMS)).toBe(true);
    expect(inWindow(DEFAULT_WINDOW, MON_08_00_AMS)).toBe(false);
    expect(inWindow(DEFAULT_WINDOW, MON_17_00_AMS)).toBe(false);
    expect(inWindow(DEFAULT_WINDOW, SAT_12_00_AMS)).toBe(false);
    expect(inWindow({ ...DEFAULT_WINDOW, tz: "America/New_York" }, MON_10_00_AMS)).toBe(false); // 04:00 there
  });

  it("validates settings", () => {
    expect(validateWindow(DEFAULT_WINDOW)).toBeNull();
    expect(validateWindow({ ...DEFAULT_WINDOW, days: [] })).toMatch(/day/);
    expect(validateWindow({ ...DEFAULT_WINDOW, start: "17:00", end: "09:00" })).toMatch(/after/);
    expect(validateWindow({ ...DEFAULT_WINDOW, start: "9am" })).toMatch(/08:30/);
    expect(validateWindow({ ...DEFAULT_WINDOW, tz: "Mars/Olympus" })).toMatch(/timezone/);
  });
});

describe("warm-up", () => {
  it("goes 10 → 30 at +2 per sending day, never above the cap", () => {
    expect(effectiveCap(30, 0)).toBe(10);
    expect(effectiveCap(30, 5)).toBe(20);
    expect(effectiveCap(30, 10)).toBe(30);
    expect(effectiveCap(30, 40)).toBe(30);
    expect(effectiveCap(8, 0)).toBe(8);
  });

  it("steps once per new day, only if the inbox sent since the last step", () => {
    expect(advanceWarmup({ warmupDay: 0, updatedOn: null }, "2026-11-09", false)).toEqual({ warmupDay: 0, updatedOn: "2026-11-09" });
    expect(advanceWarmup({ warmupDay: 0, updatedOn: "2026-11-09" }, "2026-11-09", true)).toEqual({ warmupDay: 0, updatedOn: "2026-11-09" });
    expect(advanceWarmup({ warmupDay: 0, updatedOn: "2026-11-09" }, "2026-11-10", true)).toEqual({ warmupDay: 1, updatedOn: "2026-11-10" });
    expect(advanceWarmup({ warmupDay: 4, updatedOn: "2026-11-09" }, "2026-11-12", false)).toEqual({ warmupDay: 4, updatedOn: "2026-11-12" });
    expect(advanceWarmup({ warmupDay: 4, updatedOn: "2026-11-12" }, "2026-11-10", true)).toEqual({ warmupDay: 4, updatedOn: "2026-11-12" });
  });

  it("steps back 3 days on > 3 % bounces (20+ sends) or 3 script errors, once a day", () => {
    const fresh = { warmupDay: 6, stepBackOn: null };
    expect(stepBack(fresh, "2026-11-09", { sent: 40, bounced: 1, errorsToday: 0 })).toBeNull(); // 2.5 %
    expect(stepBack(fresh, "2026-11-09", { sent: 30, bounced: 1, errorsToday: 0 })).toMatchObject({ warmupDay: 3 }); // 3.3 %
    expect(stepBack(fresh, "2026-11-09", { sent: 10, bounced: 2, errorsToday: 0 })).toBeNull(); // too few sends to judge
    expect(stepBack(fresh, "2026-11-09", { sent: 0, bounced: 0, errorsToday: 3 })?.reason).toMatch(/script errors/);
    expect(stepBack({ warmupDay: 1, stepBackOn: null }, "2026-11-09", { sent: 0, bounced: 0, errorsToday: 5 })).toMatchObject({ warmupDay: 0 });
    expect(stepBack({ warmupDay: 6, stepBackOn: "2026-11-09" }, "2026-11-09", { sent: 30, bounced: 5, errorsToday: 9 })).toBeNull();
  });
});

describe("mayHandOut", () => {
  const inbox = { window: DEFAULT_WINDOW, dailyCap: 30, warmupDay: 0, paused: false, nextSendAt: null, senderDisabled: false };

  it("hands out inside the window, under the warm-up cap, after the gap", () => {
    expect(mayHandOut(inbox, 0, MON_10_00_AMS)).toEqual({ ok: true, cap: 10 });
    expect(mayHandOut(inbox, 10, MON_10_00_AMS)).toMatchObject({ ok: false, reason: "daily_cap" });
    expect(mayHandOut({ ...inbox, nextSendAt: new Date(MON_10_00_AMS.getTime() + 60_000) }, 0, MON_10_00_AMS)).toMatchObject({ reason: "too_soon" });
    expect(mayHandOut({ ...inbox, nextSendAt: new Date(MON_10_00_AMS.getTime() - 1) }, 0, MON_10_00_AMS)).toMatchObject({ ok: true });
    expect(mayHandOut(inbox, 0, SAT_12_00_AMS)).toMatchObject({ reason: "outside_window" });
    expect(mayHandOut({ ...inbox, paused: true }, 0, MON_10_00_AMS)).toMatchObject({ reason: "paused" });
    expect(mayHandOut({ ...inbox, senderDisabled: true }, 0, MON_10_00_AMS)).toMatchObject({ reason: "sender_disabled" });
  });

  it("gaps are random between 6 and 14 minutes", () => {
    expect(nextGapMs(() => 0)).toBe(6 * 60_000);
    expect(nextGapMs(() => 1)).toBe(14 * 60_000);
    for (let i = 0; i < 50; i++) expect(nextGapMs()).toBeGreaterThanOrEqual(6 * 60_000);
  });
});

describe("inboxHealth", () => {
  const base = { window: DEFAULT_WINDOW, dailyCap: 30, warmupDay: 0, paused: false, lastHeartbeatAt: null as Date | null };
  it("not connected → warming → healthy; offline only inside the window", () => {
    expect(inboxHealth(base, MON_10_00_AMS)).toBe("not_connected");
    expect(inboxHealth({ ...base, lastHeartbeatAt: MON_10_00_AMS }, MON_10_00_AMS)).toBe("warming");
    expect(inboxHealth({ ...base, warmupDay: 10, lastHeartbeatAt: MON_10_00_AMS }, MON_10_00_AMS)).toBe("healthy");
    const threeHoursAgo = new Date(MON_10_00_AMS.getTime() - 3 * 3600_000);
    expect(inboxHealth({ ...base, lastHeartbeatAt: threeHoursAgo }, MON_10_00_AMS)).toBe("offline");
    expect(inboxHealth({ ...base, lastHeartbeatAt: new Date(SAT_12_00_AMS.getTime() - 24 * 3600_000) }, SAT_12_00_AMS)).toBe("warming");
    expect(inboxHealth({ ...base, paused: true, lastHeartbeatAt: threeHoursAgo }, MON_10_00_AMS)).toBe("paused");
  });
});

describe("sender keys", () => {
  it("are random, recognisable, and stored only as a hash", () => {
    const a = generateSenderKey();
    const b = generateSenderKey();
    expect(a).not.toBe(b);
    expect(looksLikeSenderKey(a)).toBe(true);
    expect(looksLikeSenderKey("sk-ant-123")).toBe(false);
    expect(hashSenderKey(a)).toMatch(/^[0-9a-f]{64}$/);
    expect(hashSenderKey(` ${a}\n`)).toBe(hashSenderKey(a)); // pasted with whitespace
    expect(keyPrefix(a)).toBe(a.slice(0, 9));
  });
});

describe("opt-out line and body", () => {
  it("adds the opt-out line in the email's language as its own paragraph", () => {
    expect(defaultOptOutLine("nl")).toBe("Niet relevant? Antwoord gewoon 'nee'.");
    expect(defaultOptOutLine("xx")).toBe("Not relevant? Just reply 'no'.");
    expect(composeBody("Hi Anna,\n\nBest regards\n\n", "Not relevant? Just reply 'no'.")).toBe("Hi Anna,\n\nBest regards\n\nNot relevant? Just reply 'no'.");
    expect(composeBody("Hi Anna", "  ")).toBe("Hi Anna");
    expect(composeBody("Hi Anna", null)).toBe("Hi Anna");
  });
});

describe("reply classification", () => {
  const quoted = "\n\nOn Mon, 9 Nov 2026 at 10:00, Ilias <me@x.nl> wrote:\n> Hi Anna,\n> Not relevant? Just reply 'no'.";

  it("only looks at the reply's own text, not the quoted email", () => {
    expect(ownReplyText("Sounds good, call me Tuesday." + quoted)).toBe("Sounds good, call me Tuesday.");
    expect(ownReplyText("Prima!\n\nOp ma 9 nov 2026 om 10:00 schreef Ilias <me@x.nl>:\n> tekst")).toBe("Prima!");
    expect(isUnsubscribeReply("Sounds good, call me Tuesday." + quoted)).toBe(false); // the quoted 'no' doesn't count
  });

  it("recognises stop requests in EN/NL/DE/FR", () => {
    for (const r of ["no", "No.", "nee", "Nee!", "Please unsubscribe me", "remove me from your list", "Stop emailing me", "Graag uitschrijven", "geen interesse, bedankt", "Bitte abmelden", "pas intéressé"]) {
      expect(isUnsubscribeReply(r + quoted), r).toBe(true);
    }
  });

  it("doesn't treat normal replies as stop requests", () => {
    for (const r of ["No problem, let's talk next week", "Can we move the meeting? Remove meeting notes later", "Yes please", "Not now, maybe in Q2", "Stop by our office anytime"]) {
      expect(isUnsubscribeReply(r + quoted), r).toBe(false);
    }
  });
});
