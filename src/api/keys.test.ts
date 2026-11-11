import { describe, expect, it } from "vitest";
import { BatchBody, MAX_BATCH, normaliseSource, PersonalizeBody, zodMessage } from "./schemas";
import { generateApiKey, hashApiKey, keyFromAuthHeader } from "./keys";

describe("API keys", () => {
  it("look like fl_live_ + 32 characters, hash stably, and only the prefix is shown", () => {
    const k = generateApiKey();
    expect(k.key).toMatch(/^fl_live_[0-9A-Za-z]{32}$/);
    expect(k.prefix).toBe(k.key.slice(0, 12));
    expect(k.hash).toBe(hashApiKey(k.key));
    expect(k.hash).not.toContain(k.key.slice(8));
    expect(generateApiKey().key).not.toBe(k.key);
  });

  it("are read from the Authorization header", () => {
    const { key } = generateApiKey();
    expect(keyFromAuthHeader(`Bearer ${key}`)).toBe(key);
    expect(keyFromAuthHeader(key)).toBe(key);
    expect(keyFromAuthHeader("Bearer sk-ant-xyz")).toBeNull();
    expect(keyFromAuthHeader(null)).toBeNull();
  });
});

describe("request bodies", () => {
  it("fills defaults and cleans empty strings", () => {
    const b = PersonalizeBody.parse({ lead: { email: "a@b.nl", first_name: "" }, copy: { body: "Hi [[opener]]" } });
    expect(b).toMatchObject({ lead: { email: "a@b.nl", first_name: null }, options: { writer: "pro", depth: { deep: false } }, wait: 0 });
  });

  it("explains what is wrong", () => {
    const r = PersonalizeBody.safeParse({ lead: { email: "nope" }, copy: { body: "x" } });
    expect(r.success).toBe(false);
    expect(zodMessage(r.error!).field).toBe("lead.email");
    expect(BatchBody.safeParse({ leads: Array.from({ length: MAX_BATCH + 1 }, () => ({ email: "a@b.nl" })), copy: { body: "x" } }).success).toBe(false);
    expect(PersonalizeBody.safeParse({ lead: { email: "a@b.nl" }, copy: { body: "x" }, wait: 61 }).success).toBe(false);
  });
});

describe("no-code tool leniency", () => {
  it("drops an empty campaign_id, and empty copy when a campaign_id is given", () => {
    expect(normaliseSource({ lead: {}, copy: { body: "x" }, campaign_id: "" })).toEqual({ lead: {}, copy: { body: "x" } });
    expect(normaliseSource({ lead: {}, copy: { subject: "", body: "" }, campaign_id: "c1" })).toEqual({ lead: {}, campaign_id: "c1" });
    expect(normaliseSource({ lead: {}, copy: null, campaign_id: "c1" })).toEqual({ lead: {}, campaign_id: "c1" });
    expect(normaliseSource({ lead: {}, copy: { body: "x" }, campaign_id: "c1" })).toEqual({ lead: {}, copy: { body: "x" }, campaign_id: "c1" });
    // The body Make sends (integrations/make-app): both fields always present, the unused one empty.
    const make = PersonalizeBody.parse(normaliseSource({ lead: { email: "a@b.nl", first_name: "", website: "" }, copy: { subject: "S", body: "Hi [[x · y · 5]]" }, campaign_id: "", options: { writer: "pro" }, wait: "45" }));
    expect(make).toMatchObject({ copy: { subject: "S" }, wait: 45, lead: { first_name: null, website: null } });
    expect(make.campaign_id).toBeUndefined();
  });
});
