import { describe, expect, it } from "vitest";
import { contactNotification, parseContact } from "./contact";
import { proofMode, visibleProof } from "./proof";
import { OWN_OUTREACH } from "@/content/proof";

describe("agencies contact form", () => {
  const ok = { name: " Ana  de Vries ", email: "Ana@Agency.example", company: "Agency", volume: "Under 2,000", message: "Line 1\r\nLine 2" };

  it("cleans and accepts a valid request", () => {
    expect(parseContact(ok)).toEqual({ ok: true, value: { name: "Ana de Vries", email: "ana@agency.example", company: "Agency", volume: "Under 2,000", message: "Line 1\nLine 2" } });
  });

  it("names the field that's wrong", () => {
    expect(parseContact({ ...ok, name: "" })).toEqual({ ok: false, field: "name" });
    expect(parseContact({ ...ok, email: "not-an-email" })).toEqual({ ok: false, field: "email" });
    expect(parseContact({ ...ok, volume: "a billion" })).toEqual({ ok: false, field: "volume" });
  });

  it("drops bots that fill the hidden field, and can't be used to inject email headers", () => {
    expect(parseContact({ ...ok, website: "http://spam.example" })).toEqual({ ok: false, field: null, spam: true });
    const r = parseContact({ ...ok, name: "Ana\r\nBcc: x@y.z" });
    expect(r.ok && r.value.name).toBe("Ana Bcc: x@y.z");
    expect(parseContact({ ...ok, email: "a@b.co\nbcc:c@d.ef" }).ok).toBe(false);
  });

  it("writes a plain notification with everything the owner needs", () => {
    const v = parseContact(ok);
    if (!v.ok) throw new Error("invalid");
    const m = contactNotification(v.value, "https://app.example");
    expect(m.subject).toBe("FirstLine: Agency wants to talk (Under 2,000)");
    expect(m.text).toContain("ana@agency.example");
    expect(m.text).toContain("https://app.example/admin");
  });
});

describe("SHOW_PROOF", () => {
  const items = [{ placeholder: true, n: 1 }, { placeholder: false, n: 2 }];

  it("is off by default and shows nothing", () => {
    expect(proofMode({})).toBe("off");
    expect(visibleProof(items, "off")).toEqual([]);
  });

  it("when on, never shows a placeholder", () => {
    expect(proofMode({ SHOW_PROOF: "1" })).toBe("on");
    expect(visibleProof(items, "on")).toEqual([{ placeholder: false, n: 2 }]);
  });

  it("preview shows placeholders, but never in production", () => {
    expect(proofMode({ SHOW_PROOF: "preview", NODE_ENV: "development" })).toBe("preview");
    expect(proofMode({ SHOW_PROOF: "preview", NODE_ENV: "production" })).toBe("off");
    expect(visibleProof(items, "preview")).toHaveLength(2);
  });

  it("own-outreach results: hidden while off, and while they're still placeholder numbers", () => {
    expect(OWN_OUTREACH.placeholder).toBe(true); // flip to false only with real numbers
    expect(visibleProof([OWN_OUTREACH], "off")).toEqual([]);
    expect(visibleProof([OWN_OUTREACH], "on")).toEqual([]);
    expect(visibleProof([{ ...OWN_OUTREACH, placeholder: false }], "on")).toHaveLength(1);
  });
});
