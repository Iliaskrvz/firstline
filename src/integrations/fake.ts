// Fake sending tool for tests and for clicking through without an account (key "fake-instantly").
// Stateful per instance; the app creates one per call, so it is deterministic there:
// emails containing "+skip" are skipped, "+fail" fail as invalid.
import { ToolError, type ConnectionResult, type Provider, type PushLead, type PushOutcome, type SendingTool, type ToolCampaign, type ToolEvent } from "./types";

export type FakeToolOptions = {
  provider?: Provider;
  webhooks?: boolean;
  badKey?: boolean;
  /** Throw a rate-limit error on the next N pushLeads calls. */
  rateLimitTimes?: number;
  /** Throw a transient error on the next N pushLeads calls. */
  transientTimes?: number;
  batchSize?: number;
  webhookMode?: "account" | "campaign";
};

export class FakeTool implements SendingTool {
  readonly provider: Provider;
  readonly batchSize: number;
  readonly webhookMode: "account" | "campaign";
  readonly campaignHooks = new Map<string, string>();
  readonly campaigns: ToolCampaign[] = [
    { id: "fake-camp-1", name: "Fake campaign: Q4 outreach", status: "Draft" },
    { id: "fake-camp-2", name: "Fake campaign: Agencies NL", status: "Active" },
  ];
  /** campaignId -> email -> lead */
  readonly leads = new Map<string, Map<string, PushLead & { id: string }>>();
  readonly variables = new Map<string, Set<string>>();
  readonly webhookUrls: string[] = [];
  readonly seenIdempotencyKeys = new Map<string, PushOutcome[]>();
  calls = 0;
  /** Events pollStatus returns. */
  polled: ToolEvent[] = [];

  constructor(private readonly opts: FakeToolOptions = {}) {
    this.provider = opts.provider ?? "instantly";
    this.batchSize = opts.batchSize ?? 1000;
    this.webhookMode = opts.webhookMode ?? "account";
  }

  async setupCampaignWebhook(campaignId: string, url: string) {
    if (!(this.opts.webhooks ?? true)) return { ok: false as const, reason: "This fake plan has no webhooks." };
    this.campaignHooks.set(campaignId, url);
    return { ok: true as const, ids: [`fake-hook-${campaignId}`] };
  }

  async testConnection(): Promise<ConnectionResult> {
    if (this.opts.badKey) return { ok: false, kind: "auth", reason: "The fake tool rejected the API key." };
    const webhooks = this.opts.webhooks ?? true;
    return { ok: true, accountName: "Fake workspace", webhooks, ...(webhooks ? {} : { webhooksReason: "This fake plan has no webhooks." }) };
  }

  async listCampaigns() {
    return this.campaigns;
  }

  async ensureVariables(campaignId: string, names: string[]) {
    if (!this.campaigns.some((c) => c.id === campaignId)) throw new ToolError("not_found", "Campaign not found");
    const s = this.variables.get(campaignId) ?? new Set<string>();
    names.forEach((n) => s.add(n));
    this.variables.set(campaignId, s);
  }

  async pushLeads(campaignId: string, leads: PushLead[], opts: { idempotencyKey: string }): Promise<PushOutcome[]> {
    this.calls++;
    if (this.opts.rateLimitTimes) {
      this.opts.rateLimitTimes--;
      throw new ToolError("rate_limit", "Fake rate limit", 10);
    }
    if (this.opts.transientTimes) {
      this.opts.transientTimes--;
      throw new ToolError("transient", "Fake outage");
    }
    if (leads.length > this.batchSize) throw new Error("batch too big");
    const replay = this.seenIdempotencyKeys.get(opts.idempotencyKey);
    if (replay) return replay;
    const known = this.variables.get(campaignId) ?? new Set<string>();
    const camp = this.leads.get(campaignId) ?? new Map();
    this.leads.set(campaignId, camp);
    const out = leads.map((l): PushOutcome => {
      const email = l.email.toLowerCase();
      const unknownVar = Object.keys(l.variables).find((v) => !known.has(v));
      if (unknownVar) return { ref: l.ref, status: "failed", reason: `Variable ${unknownVar} not on the campaign` };
      if (email.includes("+fail")) return { ref: l.ref, status: "failed", reason: "Invalid email address" };
      if (email.includes("+skip")) return { ref: l.ref, status: "skipped", reason: "Skipped by the tool: on your blocklist" };
      if (camp.has(email)) return { ref: l.ref, status: "skipped", reason: "Skipped by the tool: already in this campaign", duplicate: true };
      const id = `fake-lead-${camp.size + 1}`;
      camp.set(email, { ...l, email, id });
      return { ref: l.ref, status: "added", toolLeadId: id };
    });
    this.seenIdempotencyKeys.set(opts.idempotencyKey, out);
    return out;
  }

  async setupWebhooks(url: string) {
    if (!(this.opts.webhooks ?? true)) return { ok: false as const, reason: "This fake plan has no webhooks." };
    this.webhookUrls.push(url);
    return { ok: true as const, ids: ["fake-hook-1"] };
  }

  async removeWebhooks() {
    this.webhookUrls.length = 0;
  }

  handleWebhook(body: unknown): ToolEvent[] {
    const b = (body ?? {}) as Record<string, unknown>;
    const map: Record<string, ToolEvent["type"]> = { email_sent: "sent", reply_received: "replied", email_bounced: "bounced", lead_unsubscribed: "unsubscribed" };
    const type = map[String(b.event_type)];
    if (!type || typeof b.lead_email !== "string" || typeof b.campaign_id !== "string") return [];
    return [{ type, toolCampaignId: b.campaign_id, email: b.lead_email.toLowerCase(), at: typeof b.timestamp === "string" ? b.timestamp : new Date().toISOString() }];
  }

  async pollStatus(campaignId: string) {
    return this.polled.filter((e) => e.toolCampaignId === campaignId);
  }
}
