import { describe, expect, it } from "vitest";
import { RateLimiter } from "./http";
import { LemlistTool } from "./lemlist";
import { describeSendingTool } from "./testing/contract";
import { lemlistSim, lemlistWebhook } from "./testing/lemlist-sim";
import type { PushLead } from "./types";

const fast = { limiter: new RateLimiter(10_000, 1000), sleep: async () => {} };
const tool = (sim: ReturnType<typeof lemlistSim>, key = sim.key) => new LemlistTool(key, sim.fetch, fast);

describeSendingTool("Lemlist (simulated API)", () => {
  const sim = lemlistSim();
  return {
    tool: tool(sim),
    badKeyTool: tool(sim, "wrong"),
    replyWebhook: (email, campaign) => lemlistWebhook("emailsReplied", email, campaign, { text: "Thanks for reaching out" }),
  };
});

const lead = (email: string, vars: Record<string, string> = { fl_opener: "Saw your new shop" }): PushLead => ({
  ref: email,
  email,
  first_name: "Sanne",
  last_name: "de Vries",
  company: "Bakkerij Vos",
  title: "Owner",
  website: "bakkerijvos.nl",
  variables: vars,
});

describe("Lemlist adapter details", () => {
  it("uses Basic auth with an empty user, and sends variables as extra body keys", async () => {
    const sim = lemlistSim();
    const r = await tool(sim).pushLeads("cam_A1", [lead("sanne@bakkerijvos.nl")]);
    expect(r).toEqual([{ ref: "sanne@bakkerijvos.nl", status: "added", toolLeadId: "lea_1" }]);
    const req = sim.state.requests.find((q) => q.method === "POST")!;
    expect(req.auth).toBe(`Basic ${Buffer.from(`:${sim.key}`).toString("base64")}`);
    expect(req.query).toEqual({ deduplicate: "false", updateStrategy: "fillEmptyOnly" });
    expect(req.body).toEqual({ email: "sanne@bakkerijvos.nl", firstName: "Sanne", lastName: "de Vries", companyName: "Bakkerij Vos", jobTitle: "Owner", fl_opener: "Saw your new shop" });
    expect(sim.state.leads[0].vars).toEqual({ fl_opener: "Saw your new shop" });
  });

  it("treats 'already in the campaign' as a duplicate, both as 400 (now) and 409 (from 1 Dec 2026)", async () => {
    for (const status of [400, 409] as const) {
      const sim = lemlistSim({ duplicateStatus: status });
      const t = tool(sim);
      await t.pushLeads("cam_A1", [lead("a@x.nl")]);
      expect((await t.pushLeads("cam_A1", [lead("a@x.nl")]))[0]).toMatchObject({ status: "skipped", duplicate: true });
    }
  });

  it("skips graveyard addresses, fails invalid ones, and keeps going", async () => {
    const sim = lemlistSim({ graveyard: ["dead@x.nl"] });
    const r = await tool(sim).pushLeads("cam_A1", [lead("dead@x.nl"), lead("not-an-email"), lead("ok@x.nl")]);
    expect(r.map((x) => [x.status, x.reason])).toEqual([
      ["skipped", "Skipped by Lemlist: the address is in Lemlist's bounce graveyard"],
      ["failed", "Lemlist: Invalid email address"],
      ["added", undefined],
    ]);
  });

  it("waits out a 429 in the middle of a batch without losing leads", async () => {
    const sim = lemlistSim({ rateLimitAt: 2 });
    const waits: number[] = [];
    const t = new LemlistTool(sim.key, sim.fetch, { limiter: new RateLimiter(10_000, 1000), sleep: async (ms) => void waits.push(ms) });
    const r = await t.pushLeads("cam_A1", [lead("a@x.nl"), lead("b@x.nl"), lead("c@x.nl")]);
    expect(r.every((x) => x.status === "added")).toBe(true);
    expect(waits).toEqual([1000]);
    expect(sim.state.leads).toHaveLength(3);
  });

  it("stops the push on a missing campaign instead of failing each lead", async () => {
    await expect(tool(lemlistSim()).pushLeads("cam_nope", [lead("a@x.nl")])).rejects.toMatchObject({ kind: "not_found" });
  });

  it("lists campaigns (v2) without archived ones, and reads the team name", async () => {
    const sim = lemlistSim();
    expect(await tool(sim).listCampaigns()).toEqual([
      { id: "cam_A1", name: "Bakeries Utrecht", status: "Draft" },
      { id: "cam_B2", name: "Agencies NL", status: "Running" },
    ]);
    expect(sim.state.requests[0].query.version).toBe("v2");
    expect(await tool(sim).testConnection()).toEqual({ ok: true, accountName: "Acme Growth", webhooks: true });
  });

  it("registers one hook per event type with a unique URL each, and removes them", async () => {
    const sim = lemlistSim();
    const t = tool(sim);
    const r = await t.setupWebhooks("https://app/api/integrations/webhook/i/t");
    expect(r.ok && r.ids).toHaveLength(6);
    expect(sim.state.hooks.map((h) => h.type)).toEqual(["emailsSent", "emailsReplied", "emailsBounced", "emailsUnsubscribed", "entityUnsubscribed", "variableUnsubscribed"]);
    expect(new Set(sim.state.hooks.map((h) => h.targetUrl)).size).toBe(6);
    await t.removeWebhooks(r.ok ? r.ids : []);
    expect(sim.state.hooks).toEqual([]);
    const denied = await tool(lemlistSim({ noIntegrationsPermission: true })).setupWebhooks("https://x");
    expect(denied).toEqual({ ok: false, reason: 'The Lemlist user of this key needs the "Edit integrations" permission for webhooks.' });
  });

  it("maps webhook events, including the new unsubscribe types, and ignores third-party replies", () => {
    const t = tool(lemlistSim());
    expect(t.handleWebhook(lemlistWebhook("emailsSent", "A@x.nl", "cam_A1"))).toEqual([{ type: "sent", toolCampaignId: "cam_A1", email: "a@x.nl", at: "2026-11-12T09:00:00.000Z", step: 1 }]);
    expect(t.handleWebhook(lemlistWebhook("entityUnsubscribed", "a@x.nl", "cam_A1"))[0].type).toBe("unsubscribed");
    expect(t.handleWebhook(lemlistWebhook("variableUnsubscribed", "a@x.nl", "cam_A1"))[0].type).toBe("unsubscribed");
    expect(t.handleWebhook(lemlistWebhook("emailsBounced", "a@x.nl", "cam_A1"))[0].type).toBe("bounced");
    expect(t.handleWebhook(lemlistWebhook("emailsReplied", "x@else.nl", "cam_A1", { isThirdPartyReply: true }))).toEqual([]);
    expect(t.handleWebhook(lemlistWebhook("emailsOpened", "a@x.nl", "cam_A1"))).toEqual([]);
  });

  it("polls activities (version v2) for replies, bounces and unsubscribes", async () => {
    const sim = lemlistSim();
    sim.state.activities.push(
      { _id: "act_1", type: "emailsReplied", campaignId: "cam_A1", leadEmail: "r@x.nl", createdAt: "2026-11-12T09:00:00Z" },
      { _id: "act_2", type: "emailsBounced", campaignId: "cam_A1", leadEmail: "b@x.nl", createdAt: "2026-11-12T09:00:00Z" },
      { _id: "act_3", type: "entityUnsubscribed", campaignId: "cam_A1", leadEmail: "u@x.nl", createdAt: "2026-11-12T09:00:00Z" },
      { _id: "act_4", type: "emailsReplied", campaignId: "cam_B2", leadEmail: "other@x.nl", createdAt: "2026-11-12T09:00:00Z" },
    );
    const ev = await tool(sim).pollStatus("cam_A1");
    expect(ev.map((e) => `${e.type}:${e.email}`).sort()).toEqual(["bounced:b@x.nl", "replied:r@x.nl", "unsubscribed:u@x.nl"]);
  });
});
