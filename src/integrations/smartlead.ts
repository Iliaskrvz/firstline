// Smartlead API adapter (api.smartlead.ai, checked 2026-11-11).
// Base https://server.smartlead.ai/api/v1; the key goes in the query string (?api_key=), so URLs are
// never logged or shown (see http.ts). Leads: POST /campaigns/{id}/leads with lead_list (≤ 400) and
// custom_fields per lead; no idempotency key, so a retried batch shows up as "already in campaign".
// Webhooks are created per campaign: user-level ones would replace the customer's own webhooks.
import { callJson, RateLimiter, type CallOptions } from "./http";
import { ToolError, type ConnectionResult, type FetchLike, type PushLead, type PushOutcome, type SendingTool, type ToolCampaign, type ToolEvent, type ToolEventType } from "./types";

export const SMARTLEAD_BASE = "https://server.smartlead.ai/api/v1";
/** Smartlead's documented standard limit: 60 requests per 60 seconds per key. We stay a little under. */
const limiter = new RateLimiter(55, 60_000);

const WEBHOOK_EVENTS: Record<string, ToolEventType> = {
  EMAIL_SENT: "sent",
  EMAIL_REPLY: "replied",
  EMAIL_BOUNCE: "bounced",
  LEAD_UNSUBSCRIBED: "unsubscribed",
};

const POLL: { emailStatus: string; type: ToolEventType }[] = [
  { emailStatus: "is_replied", type: "replied" },
  { emailStatus: "is_bounced", type: "bounced" },
  { emailStatus: "is_unsubscribed", type: "unsubscribed" },
];

const STATUS: Record<string, string> = { ACTIVE: "Active", PAUSED: "Paused", STOPPED: "Stopped", ARCHIVED: "Archived", DRAFTED: "Draft", COMPLETED: "Completed" };
const MAX_PAGES = 100;
const str = (v: unknown) => (typeof v === "string" && v.trim() ? v.trim() : typeof v === "number" ? String(v) : null);

export class SmartleadTool implements SendingTool {
  readonly provider = "smartlead" as const;
  readonly batchSize = 400;
  readonly webhookMode = "campaign" as const;
  private readonly o: CallOptions;

  constructor(
    private readonly apiKey: string,
    fetchFn: FetchLike = fetch as unknown as FetchLike,
    opts: { limiter?: RateLimiter } = {},
  ) {
    this.o = { fetch: fetchFn, tool: "Smartlead", limiter: opts.limiter ?? limiter, limiterKey: apiKey.slice(-12) };
  }

  private url(path: string, q: Record<string, string> = {}) {
    return `${SMARTLEAD_BASE}${path}?${new URLSearchParams({ ...q, api_key: this.apiKey })}`;
  }

  async testConnection(): Promise<ConnectionResult> {
    try {
      await this.listCampaigns();
      // Webhooks: no plan rule is documented; they're created per campaign at the first push, with polling as fallback.
      return { ok: true, accountName: null, webhooks: true };
    } catch (e) {
      if (e instanceof ToolError) return { ok: false, kind: e.kind, reason: e.kind === "auth" ? "Smartlead rejected the API key. Copy it again from Smartlead → Settings → API Keys." : e.message };
      throw e;
    }
  }

  async listCampaigns(): Promise<ToolCampaign[]> {
    // Documented as a bare array; one docs section shows {campaigns: [...]}, so accept both.
    const r = await callJson<unknown>(this.o, "GET", this.url("/campaigns/"));
    const list = Array.isArray(r) ? r : ((r as { campaigns?: unknown[]; data?: unknown[] } | null)?.campaigns ?? (r as { data?: unknown[] } | null)?.data ?? []);
    return (list as { id: number | string; name?: string; status?: string }[])
      .filter((c) => c && c.id != null && c.status !== "ARCHIVED")
      .map((c) => ({ id: String(c.id), name: c.name ?? String(c.id), status: STATUS[c.status ?? ""] ?? c.status ?? "Unknown" }));
  }

  /** Smartlead custom fields need no declaration. */
  async ensureVariables(): Promise<void> {}

  async pushLeads(campaignId: string, leads: PushLead[]): Promise<PushOutcome[]> {
    if (leads.length > this.batchSize) throw new Error(`At most ${this.batchSize} leads per call`);
    const lead_list = leads.map((l) => {
      const o: Record<string, unknown> = { email: l.email };
      if (l.first_name) o.first_name = l.first_name;
      if (l.last_name) o.last_name = l.last_name;
      if (l.company) o.company_name = l.company;
      if (l.website) o.website = l.website;
      const custom: Record<string, string> = { ...l.variables };
      if (l.title && !("job_title" in custom)) custom.job_title = l.title;
      if (Object.keys(custom).length) o.custom_fields = custom;
      return o;
    });
    const r = await callJson<{ added_count?: number; skipped_count?: number; skipped_leads?: unknown[]; upload_count?: number; already_added_to_campaign?: number }>(
      this.o,
      "POST",
      this.url(`/campaigns/${encodeURIComponent(campaignId)}/leads`),
      // Defaults: respect the global block list, unsubscribes and community bounce list.
      { body: { lead_list, settings: { ignore_global_block_list: false, ignore_unsubscribe_list: false, ignore_community_bounce_list: false, ignore_duplicate_leads_in_other_campaign: false } } },
    );

    const skipped = new Map<string, string | null>();
    for (const s of r?.skipped_leads ?? []) {
      if (typeof s === "string") skipped.set(s.toLowerCase(), null);
      else if (s && typeof s === "object") {
        const e = str((s as Record<string, unknown>).email ?? (s as Record<string, unknown>).lead_email);
        if (e) skipped.set(e.toLowerCase(), str((s as Record<string, unknown>).reason ?? (s as Record<string, unknown>).message));
      }
    }
    const added = r?.added_count ?? r?.upload_count;
    const skippedCount = r?.skipped_count ?? r?.already_added_to_campaign ?? 0;
    // Smartlead doesn't always say which leads it skipped. If the counts say nobody was added, everyone was skipped.
    const noneAdded = typeof added === "number" && added === 0 && skippedCount >= leads.length;
    return leads.map((l): PushOutcome => {
      const e = l.email.toLowerCase();
      if (skipped.has(e) || noneAdded) {
        const why = skipped.get(e);
        const duplicate = !why || /already|duplicate|exist/i.test(why);
        return { ref: l.ref, status: "skipped", reason: why ? `Skipped by Smartlead: ${why}` : "Skipped by Smartlead: already in this campaign, unsubscribed or blocked", duplicate };
      }
      return { ref: l.ref, status: "added" };
    });
  }

  /** Account-wide webhooks aren't used (see webhookMode). */
  async setupWebhooks(): Promise<{ ok: true; ids: string[] }> {
    return { ok: true, ids: [] };
  }

  async setupCampaignWebhook(campaignId: string, url: string): Promise<{ ok: true; ids: string[] } | { ok: false; reason: string }> {
    try {
      const r = await callJson<{ id?: number | string; ok?: boolean }>(this.o, "POST", this.url("/webhook/create"), {
        body: {
          name: "FirstLine",
          webhook_url: url,
          association_type: "campaign",
          email_campaign_id: Number.isFinite(Number(campaignId)) ? Number(campaignId) : campaignId,
          event_type_map: Object.fromEntries(Object.keys(WEBHOOK_EVENTS).map((k) => [k, true])),
        },
      });
      return { ok: true, ids: r?.id != null ? [String(r.id)] : [] };
    } catch (e) {
      if (e instanceof ToolError) return { ok: false, reason: e.message };
      throw e;
    }
  }

  async removeWebhooks(ids: string[]): Promise<void> {
    for (const id of ids) await callJson(this.o, "DELETE", this.url(`/webhook/delete/${encodeURIComponent(id)}`)).catch(() => {});
  }

  handleWebhook(body: unknown): ToolEvent[] {
    if (!body || typeof body !== "object") return [];
    const b = body as Record<string, unknown>;
    const type = WEBHOOK_EVENTS[String(b.event_type)];
    const lead = b.lead && typeof b.lead === "object" ? (b.lead as Record<string, unknown>) : {};
    const email = str(b.to_email ?? b.lead_email ?? lead.email);
    const campaign = str(b.campaign_id ?? b.email_campaign_id);
    if (!type || !email || !campaign) return [];
    const at = str(b.time_replied ?? b.time_sent ?? b.event_timestamp ?? b.timestamp) ?? new Date().toISOString();
    const step = typeof b.sequence_number === "number" ? b.sequence_number : null;
    // Reply body, subject and preview text are ignored on purpose.
    return [{ type, toolCampaignId: campaign, email: email.toLowerCase(), at, step }];
  }

  async pollStatus(campaignId: string): Promise<ToolEvent[]> {
    const out: ToolEvent[] = [];
    for (const { emailStatus, type } of POLL) {
      for (let page = 0; page < MAX_PAGES; page++) {
        const r = await callJson<{ total_leads?: string | number; data?: { lead?: { email?: string }; created_at?: string }[] }>(
          this.o,
          "GET",
          this.url(`/campaigns/${encodeURIComponent(campaignId)}/leads`, { offset: String(page * 100), limit: "100", emailStatus }),
        );
        const rows = r?.data ?? [];
        for (const row of rows) {
          const email = str(row.lead?.email);
          if (email) out.push({ type, toolCampaignId: campaignId, email: email.toLowerCase(), at: new Date().toISOString() });
        }
        if (rows.length < 100) break;
      }
    }
    return out;
  }
}
