import { describe, expect, it } from "vitest";
import { addWorkingDays, followUpSubject, renderPlainStep, validateStep, zonedTime } from "./sequence";

const VARS = ["first_name", "company"];

describe("validateStep", () => {
  it("accepts a plain follow-up with variables", () => {
    expect(validateStep({ delay_days: 3, kind: "plain", template_body: "Hi {{first_name}}, any thoughts?" }, VARS)).toEqual([]);
  });
  it("rejects slots in plain steps and missing slots in personalised steps", () => {
    expect(validateStep({ delay_days: 3, kind: "plain", template_body: "Hi [[p · something · 10]]" }, VARS)[0]).toMatch(/plain follow-up can't/);
    expect(validateStep({ delay_days: 3, kind: "personalised", template_body: "Hi {{first_name}}" }, VARS)[0]).toMatch(/at least one/);
    expect(validateStep({ delay_days: 3, kind: "personalised", template_body: "Hi [[p · a different angle · 20]]" }, VARS)).toEqual([]);
  });
  it("checks the delay, empty text and broken markers", () => {
    expect(validateStep({ delay_days: -1, kind: "plain", template_body: "x" }, VARS)[0]).toMatch(/working days/);
    expect(validateStep({ delay_days: 31, kind: "plain", template_body: "x" }, VARS)[0]).toMatch(/working days/);
    expect(validateStep({ delay_days: 2, kind: "plain", template_body: "  " }, VARS)).toEqual(["Write the follow-up text."]);
    expect(validateStep({ delay_days: 2, kind: "plain", template_body: "Hi {{first_name" }, VARS).length).toBeGreaterThan(0);
  });
});

describe("plain follow-ups", () => {
  it("fills variables and tidies blank lines", () => {
    expect(renderPlainStep("Hi {{first_name}},\n\n\n\nStill keen on {{company}}?", { first_name: "Anna", company: "Acme" })).toBe(
      "Hi Anna,\n\nStill keen on Acme?",
    );
  });
  it("reply subject", () => {
    expect(followUpSubject("Idea for Acme")).toBe("Re: Idea for Acme");
    expect(followUpSubject("RE: Idea")).toBe("RE: Idea");
  });
});

describe("working days", () => {
  const tz = "Europe/Amsterdam";
  it("converts a local wall-clock time to an instant", () => {
    expect(zonedTime("2026-11-10", "00:00", tz).toISOString()).toBe("2026-11-09T23:00:00.000Z"); // CET = UTC+1
    expect(zonedTime("2026-07-10", "08:30", tz).toISOString()).toBe("2026-07-10T06:30:00.000Z"); // CEST = UTC+2
  });
  it("skips weekends and starts at local midnight", () => {
    const thu = new Date("2026-11-12T14:00:00Z"); // Thursday 15:00 Amsterdam
    expect(addWorkingDays(thu, 0, tz)).toEqual(thu);
    expect(addWorkingDays(thu, 1, tz).toISOString()).toBe("2026-11-12T23:00:00.000Z"); // Friday 00:00
    expect(addWorkingDays(thu, 2, tz).toISOString()).toBe("2026-11-15T23:00:00.000Z"); // Monday 00:00
    expect(addWorkingDays(thu, 5, tz).toISOString()).toBe("2026-11-18T23:00:00.000Z"); // next Thursday
  });
  it("counts from the inbox's local date, not UTC", () => {
    const friLateUtc = new Date("2026-11-13T23:30:00Z"); // already Saturday 00:30 in Amsterdam
    expect(addWorkingDays(friLateUtc, 1, tz).toISOString()).toBe("2026-11-15T23:00:00.000Z"); // Monday
  });
});
