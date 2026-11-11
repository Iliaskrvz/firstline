import { describe, expect, it } from "vitest";
import { RateLimiter } from "./http";
import { SmartleadTool } from "./smartlead";
import { describeSendingTool } from "./testing/contract";
import { smartleadSim, smartleadWebhook } from "./testing/smartlead-sim";
import { ToolError, type PushLead } from "./types";

const free = () => new RateLimiter(1000, 1000);
const tool = (sim: ReturnType<typeof smartleadSim>, key = sim.key) => new SmartleadTool(key, sim.fetch, { limiter: free() });

describeSendingTool("Smartlead (simulated API)", () => {
  const sim = smartleadSim();
  return {
    tool: tool(sim),
    badKeyTool: tool(sim, "wrong"),
    replyWebhook: (email, campaign) => smartleadWebhook("EMAIL_REPLY", email, campaign, { reply_body: "Thanks for reaching out", preview_text: "Thanks", subject: "Re: idea" }),
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

describe("Smartlead adapter details", () => {
  it("puts the key in the query string, sends lead_list with custom_fields, and keeps the key out of errors", async () => {
    const sim = smartleadSim();
    const t = tool(sim);
    await t.pushLeads("3001", [lead("sanne@bakkerijvos.nl")]);
    const req = sim.state.requests.find((r) => r.method === "POST")!;
    expect(req.path).toBe("/campaigns/3001/leads");
    expect(req.query.api_key).toBe(sim.key);
    expect(req.body).toEqual({
      lead_list: [
        {
          email: "sanne@bakkerijvos.nl",
          first_name: "Sanne",
          last_name: "de Vries",
          company_name: "Bakkerij Vos",
          website: "bakkerijvos.nl",
          custom_fields: { fl_opener: "Saw your new shop", job_title: "Owner" },
        },
      ],
      settings: { ignore_global_block_list: false, ignore_unsubscribe_list: false, ignore_community_bounce_list: false, ignore_duplicate_leads_in_other_campaign: false },
    });
    const err = await tool(sim).pushLeads("9999", [lead("a@b.nl")]).catch((e: Error) => e);
    expect(err).toBeInstanceOf(ToolError);
    expect((err as Error).message).not.toContain(sim.key);
  });

  it("lists campaigns from a bare array and hides archived ones", async () => {
    expect(await tool(smartleadSim()).listCampaigns()).toEqual([
      { id: "3001", name: "Bakeries Utrecht", status: "Draft" },
      { id: "3002", name: "Agencies NL", status: "Active" },
    ]);
  });

  it("reads skipped leads in every documented shape", async () => {
    for (const shape of ["objects", "strings", "none"] as const) {
      const sim = smartleadSim({ skippedShape: shape });
      const t = tool(sim);
      await t.pushLeads("3001", [lead("a@x.nl")]);
      const again = await t.pushLeads("3001", [lead("a@x.nl")]);
      expect(again[0]).toMatchObject({ status: "skipped", duplicate: true });
    }
    const sim = smartleadSim({ blocklist: ["blocked@x.nl"] });
    const r = await tool(sim).pushLeads("3001", [lead("ok@x.nl"), lead("blocked@x.nl")]);
    expect(r).toEqual([
      { ref: "ok@x.nl", status: "added" },
      { ref: "blocked@x.nl", status: "skipped", reason: "Skipped by Smartlead: Lead is in global block list", duplicate: false },
    ]);
  });

  it("refuses more than 400 leads per call, and turns 429 into a wait", async () => {
    const t = tool(smartleadSim());
    await expect(t.pushLeads("3001", Array.from({ length: 401 }, (_, i) => lead(`x${i}@y.nl`)))).rejects.toThrow(/400/);
    const err = await tool(smartleadSim({ rateLimitTimes: 1 })).listCampaigns().catch((e: ToolError) => e);
    expect(err).toMatchObject({ kind: "rate_limit", retryAfterMs: 2000 });
  });

  it("creates one webhook per campaign with the 4 events, and removes it", async () => {
    const sim = smartleadSim();
    const t = tool(sim);
    const r = await t.setupCampaignWebhook("3001", "https://app/api/integrations/webhook/i/t");
    expect(r).toEqual({ ok: true, ids: ["901"] });
    expect(sim.state.webhooks[0]).toMatchObject({ email_campaign_id: 3001, event_type_map: { EMAIL_SENT: true, EMAIL_REPLY: true, EMAIL_BOUNCE: true, LEAD_UNSUBSCRIBED: true } });
    expect(sim.state.requests.find((q) => q.path === "/webhook/create")?.body).toMatchObject({ association_type: "campaign" });
    await t.removeWebhooks(["901"]);
    expect(sim.state.webhooks).toEqual([]);
    expect((await tool(smartleadSim({ webhooksForbidden: true })).setupCampaignWebhook("3001", "https://x")).ok).toBe(false);
  });

  it("maps webhook events (to_email, lead_email) and ignores reply text", () => {
    const t = tool(smartleadSim());
    expect(t.handleWebhook(smartleadWebhook("EMAIL_SENT", "A@x.nl", 3001))).toEqual([{ type: "sent", toolCampaignId: "3001", email: "a@x.nl", at: expect.any(String), step: 1 }]);
    expect(t.handleWebhook(smartleadWebhook("EMAIL_BOUNCE", "a@x.nl", 3001))[0].type).toBe("bounced");
    expect(t.handleWebhook(smartleadWebhook("LEAD_UNSUBSCRIBED", "a@x.nl", 3001))[0]).toMatchObject({ type: "unsubscribed", email: "a@x.nl" });
    expect(t.handleWebhook(smartleadWebhook("EMAIL_OPEN", "a@x.nl", 3001))).toEqual([]);
    expect(JSON.stringify(t.handleWebhook(smartleadWebhook("EMAIL_REPLY", "a@x.nl", 3001, { reply_body: "Call me Tuesday" })))).not.toContain("Tuesday");
  });

  it("polls replied, bounced and unsubscribed leads page by page", async () => {
    const sim = smartleadSim();
    const t = tool(sim);
    await t.pushLeads("3001", Array.from({ length: 150 }, (_, i) => lead(`l${i}@x.nl`, {})));
    sim.state.leads.forEach((l, i) => (l.replied = i < 120));
    sim.state.leads[130].bounced = true;
    sim.state.leads[140].unsubscribed = true;
    const ev = await t.pollStatus("3001");
    expect(ev.filter((e) => e.type === "replied")).toHaveLength(120);
    expect(ev.filter((e) => e.type === "bounced").map((e) => e.email)).toEqual(["l130@x.nl"]);
    expect(ev.filter((e) => e.type === "unsubscribed").map((e) => e.email)).toEqual(["l140@x.nl"]);
  });
});
