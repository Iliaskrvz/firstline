// The adapter test suite every sending tool must pass (Instantly now; Smartlead and Lemlist in Phase 8).
import { describe, expect, it } from "vitest";
import type { PushLead, SendingTool } from "../types";

export type ContractSetup = {
  tool: SendingTool;
  badKeyTool: SendingTool;
  /** A body the tool's webhook would send for a reply from this lead in this campaign. */
  replyWebhook(email: string, campaignId: string): unknown;
};

const lead = (n: number, extra: Partial<PushLead> = {}): PushLead => ({
  ref: `ref-${n}`,
  email: `person${n}@example.com`,
  first_name: `P${n}`,
  last_name: null,
  company: "Example BV",
  title: null,
  website: "example.com",
  variables: { fl_opener: `Opener ${n}`, fl_full_email: `Email ${n}` },
  ...extra,
});

export function describeSendingTool(name: string, setup: () => ContractSetup) {
  describe(`${name}: sending-tool contract`, () => {
    it("tests the connection and rejects a bad key", async () => {
      const { tool, badKeyTool } = setup();
      const ok = await tool.testConnection();
      expect(ok.ok).toBe(true);
      const bad = await badKeyTool.testConnection();
      expect(bad).toMatchObject({ ok: false, kind: "auth" });
    });

    it("lists campaigns", async () => {
      const cs = await setup().tool.listCampaigns();
      expect(cs.length).toBeGreaterThan(0);
      expect(cs[0]).toEqual({ id: expect.any(String), name: expect.any(String), status: expect.any(String) });
    });

    it("adds leads with variables, skips them the second time, and a replayed call never adds twice", async () => {
      const { tool } = setup();
      const [c] = await tool.listCampaigns();
      await tool.ensureVariables(c.id, ["fl_opener", "fl_full_email"]);
      const first = await tool.pushLeads(c.id, [lead(1), lead(2)], { idempotencyKey: "k1" });
      expect(first.map((r) => [r.ref, r.status])).toEqual([["ref-1", "added"], ["ref-2", "added"]]);
      // A replayed call (same key) either returns the same answer (tools with idempotency keys) or
      // reports the leads as duplicates, so the push can count them as added once.
      const replay = await tool.pushLeads(c.id, [lead(1), lead(2)], { idempotencyKey: "k1" });
      for (const r of replay) expect(r.status === "added" || (r.status === "skipped" && r.duplicate === true)).toBe(true);
      const again = await tool.pushLeads(c.id, [lead(1), lead(3)], { idempotencyKey: "k2" });
      expect(again.find((r) => r.ref === "ref-1")?.status).toBe("skipped");
      expect(again.find((r) => r.ref === "ref-1")?.reason).toMatch(/already (in|exists in) (this )?campaign/i);
      expect(again.find((r) => r.ref === "ref-1")?.duplicate).toBe(true);
      expect(again.find((r) => r.ref === "ref-3")?.status).toBe("added");
      expect(tool.batchSize).toBeGreaterThan(0);
    });

    it("parses webhooks into status flags only", () => {
      const { tool, replyWebhook } = setup();
      const ev = tool.handleWebhook(replyWebhook("Person1@Example.com", "camp-x"));
      expect(ev).toHaveLength(1);
      expect(ev[0]).toMatchObject({ type: "replied", toolCampaignId: "camp-x", email: "person1@example.com" });
      expect(JSON.stringify(ev)).not.toMatch(/reply_text|Thanks for reaching out/);
      expect(tool.handleWebhook({ event_type: "email_opened", lead_email: "a@b.c", campaign_id: "x" })).toEqual([]);
      expect(tool.handleWebhook("garbage")).toEqual([]);
    });

    it("sets up webhooks for the account or per campaign", async () => {
      const { tool } = setup();
      const url = "https://app.example/api/integrations/webhook/id/token";
      if (tool.webhookMode === "account") expect((await tool.setupWebhooks(url)).ok).toBe(true);
      else {
        const [c] = await tool.listCampaigns();
        const r = await tool.setupCampaignWebhook!(c.id, url);
        expect(r.ok).toBe(true);
      }
    });
  });
}
