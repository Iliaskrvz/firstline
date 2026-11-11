import { describe, expect, it } from "vitest";
import { FakeTool } from "./fake";
import { InstantlyTool } from "./instantly";
import { createTool, isFakeKey } from "./registry";
import { describeSendingTool } from "./testing/contract";
import { instantlySim, instantlyWebhook } from "./testing/instantly-sim";
import { ToolError, type PushLead } from "./types";

describeSendingTool("Fake tool", () => ({
  tool: new FakeTool(),
  badKeyTool: new FakeTool({ badKey: true }),
  replyWebhook: (email, campaign) => instantlyWebhook("reply_received", email, campaign, { reply_text: "Thanks for reaching out" }),
}));

describeSendingTool("Instantly (simulated API v2)", () => {
  const sim = instantlySim();
  return {
    tool: new InstantlyTool("test-key", sim.fetch),
    badKeyTool: new InstantlyTool("wrong", sim.fetch),
    replyWebhook: (email, campaign) => instantlyWebhook("reply_received", email, campaign, { reply_text: "Thanks for reaching out", reply_html: "<p>Thanks</p>" }),
  };
});

const lead = (email: string, vars: Record<string, string> = { fl_opener: "Hi" }): PushLead => ({
  ref: email,
  email,
  first_name: "Sanne",
  last_name: null,
  company: "Bakkerij Vos",
  title: null,
  website: "bakkerijvos.nl",
  variables: vars,
});

describe("Instantly adapter details", () => {
  it("sends the v2 bearer key and the documented lead fields, without nulls", async () => {
    const sim = instantlySim();
    const t = new InstantlyTool("test-key", sim.fetch);
    const [c] = await t.listCampaigns();
    await t.ensureVariables(c.id, ["fl_opener"]);
    await t.pushLeads(c.id, [lead("sanne@bakkerijvos.nl")], { idempotencyKey: "abc" });
    const add = sim.state.requests.find((r) => r.path === "/leads/add")!;
    expect(add.auth).toBe("Bearer test-key");
    expect(add.body).toEqual({
      campaign_id: c.id,
      skip_if_in_campaign: true,
      idempotency_key: "abc",
      leads: [{ email: "sanne@bakkerijvos.nl", first_name: "Sanne", company_name: "Bakkerij Vos", website: "bakkerijvos.nl", custom_variables: { fl_opener: "Hi" } }],
    });
    expect(sim.state.variables.get(c.id)).toEqual(["fl_opener"]);
    // Variables are created before leads are added.
    const order = sim.state.requests.map((r) => r.path);
    expect(order.indexOf(`/campaigns/${c.id}/variables`)).toBeLessThan(order.indexOf("/leads/add"));
  });

  it("explains plan, scope and rate-limit problems", async () => {
    const unpaid = await new InstantlyTool("test-key", instantlySim({ plan: "unpaid" }).fetch).testConnection();
    expect(unpaid).toMatchObject({ ok: false, kind: "plan" });
    expect(!unpaid.ok && unpaid.reason).toMatch(/paid plan/);

    const noHooks = await new InstantlyTool("test-key", instantlySim({ plan: "no-webhooks" }).fetch).testConnection();
    expect(noHooks).toMatchObject({ ok: true, webhooks: false, accountName: "Acme Outreach" });

    const sim = instantlySim({ rateLimitTimes: 1 });
    const t = new InstantlyTool("test-key", sim.fetch);
    const [c] = await t.listCampaigns();
    const err = await t.pushLeads(c.id, [lead("a@b.nl")], { idempotencyKey: "x" }).catch((e) => e);
    expect(err).toBeInstanceOf(ToolError);
    expect(err).toMatchObject({ kind: "rate_limit", retryable: true });
    expect((err as ToolError).retryAfterMs).toBeGreaterThan(0);
  });

  it("reports why leads were skipped", async () => {
    const sim = instantlySim({ blocklist: ["blocked@x.nl"] });
    const t = new InstantlyTool("test-key", sim.fetch);
    const [c] = await t.listCampaigns();
    const r = await t.pushLeads(c.id, [lead("ok@x.nl", {}), lead("blocked@x.nl", {})], { idempotencyKey: "y" });
    expect(r).toEqual([
      { ref: "ok@x.nl", status: "added", toolLeadId: "lead_1" },
      { ref: "blocked@x.nl", status: "skipped", reason: "Skipped by Instantly: on your Instantly blocklist" },
    ]);
  });

  it("pages through campaigns", async () => {
    const sim = instantlySim();
    for (let i = 0; i < 150; i++) sim.state.campaigns.push({ id: `c${i}`, name: `C${i}`, status: 2 });
    const cs = await new InstantlyTool("test-key", sim.fetch).listCampaigns();
    expect(cs).toHaveLength(152);
    expect(cs.at(-1)).toEqual({ id: "c149", name: "C149", status: "Paused" });
  });

  it("creates the four webhooks and removes them again", async () => {
    const sim = instantlySim();
    const t = new InstantlyTool("test-key", sim.fetch);
    const r = await t.setupWebhooks("https://x/api/integrations/webhook/1/tok");
    expect(r).toEqual({ ok: true, ids: ["wh_1", "wh_2", "wh_3", "wh_4"] });
    expect(sim.state.webhooks.map((w) => w.event_type)).toEqual(["email_sent", "reply_received", "email_bounced", "lead_unsubscribed"]);
    await t.removeWebhooks(r.ok ? r.ids : []);
    expect(sim.state.webhooks).toEqual([]);
    const blocked = await new InstantlyTool("test-key", instantlySim({ plan: "no-webhooks" }).fetch).setupWebhooks("https://x");
    expect(blocked.ok).toBe(false);
  });

  it("maps webhook event types", () => {
    const t = new InstantlyTool("k");
    expect(t.handleWebhook(instantlyWebhook("email_bounced", "a@b.nl", "c1"))[0].type).toBe("bounced");
    expect(t.handleWebhook(instantlyWebhook("lead_unsubscribed", "a@b.nl", "c1"))[0].type).toBe("unsubscribed");
    expect(t.handleWebhook(instantlyWebhook("email_sent", "a@b.nl", "c1"))[0]).toMatchObject({ type: "sent", step: 1 });
    expect(t.handleWebhook(instantlyWebhook("lead_interested", "a@b.nl", "c1"))).toEqual([]);
  });

  it("polls replied, bounced and unsubscribed leads", async () => {
    const sim = instantlySim();
    const t = new InstantlyTool("test-key", sim.fetch);
    const [c] = await t.listCampaigns();
    await t.pushLeads(c.id, [lead("r@x.nl", {}), lead("b@x.nl", {}), lead("u@x.nl", {}), lead("q@x.nl", {})], { idempotencyKey: "z" });
    sim.state.leads[0].timestamp_last_reply = "2026-11-12T09:00:00.000Z";
    sim.state.leads[1].status = -1;
    sim.state.leads[2].status = -2;
    const ev = await t.pollStatus(c.id);
    const of = (type: string) => ev.filter((e) => e.type === type).map((e) => e.email).sort();
    expect(of("replied")).toEqual(["r@x.nl"]);
    expect(of("bounced")).toEqual(["b@x.nl"]);
    expect(of("unsubscribed")).toEqual(["u@x.nl"]);
    expect(of("sent")).toEqual(["b@x.nl", "r@x.nl", "u@x.nl"]);
  });

  it("uses the fake only for fake keys outside production", () => {
    expect(isFakeKey("fake-instantly")).toBe(true);
    expect(createTool("instantly", "fake-instantly", { env: { NODE_ENV: "development" } })).toBeInstanceOf(FakeTool);
    expect(() => createTool("instantly", "fake-instantly", { env: { NODE_ENV: "production" } })).toThrow();
    expect(createTool("instantly", "real-key", { env: {} })).toBeInstanceOf(InstantlyTool);
  });
});
