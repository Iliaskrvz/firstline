// Lemlist API adapter (developer.lemlist.com, checked 2026-11-11).
// Base https://api.lemlist.com/api; HTTP Basic auth with an empty user and the key as password.
// No bulk endpoint: each lead is one POST /campaigns/{id}/leads/ with its custom variables as extra
// body keys (that creates them; variables can't be re-added with the same name, so we never call the
// add-variables endpoint). "Already in the campaign" is 400 today and becomes 409 on 1 Dec 2026: both count.
// Rate limit 20 requests per 2 seconds per key. Webhooks: one per event type (a target URL can only be
// registered once), team-wide; unsubscribes now come as entityUnsubscribed / variableUnsubscribed.
import { callJson, RateLimiter, type CallOptions } from "./http";
import { ToolError, type ConnectionResult, type FetchLike, type PushLead, type PushOutcome, type SendingTool, type ToolCampaign, type ToolEvent, type ToolEventType } from "./types";

export const LEMLIST_BASE = "https://api.lemlist.com/api";
const limiter = new RateLimiter(18, 2_000);

export const LEMLIST_EVENTS: Record<string, ToolEventType> = {
  emailsSent: "sent",
  emailsReplied: "replied",
  emailsBounced: "bounced",
  emailsUnsubscribed: "unsubscribed",
  entityUnsubscribed: "unsubscribed",
  variableUnsubscribed: "unsubscribed",
};
const POLL_TYPES = ["emailsReplied", "emailsBounced", "emailsUnsubscribed", "entityUnsubscribed", "variableUnsubscribed"];
const STATUS: Record<string, string> = { running: "Running", paused: "Paused", draft: "Draft", ended: "Ended", archived: "Archived", errors: "Has errors" };
const MAX_PAGES = 50;
const LEAD_TRIES = 5;
const str = (v: unknown) => (typeof v === "string" && v.trim() ? v.trim() : null);

export class LemlistTool implements SendingTool {
  readonly provider = "lemlist" as const;
  /** Leads per pushLeads call (one request each). */
  readonly batchSize = 50;
  readonly webhookMode = "account" as const;
  private readonly o: CallOptions;
  private readonly auth: Record<string, string>;
  private readonly sleep: (ms: number) => Promise<void>;

  constructor(apiKey: string, fetchFn: FetchLike = fetch as unknown as FetchLike, opts: { limiter?: RateLimiter; sleep?: (ms: number) => Promise<void> } = {}) {
    this.o = { fetch: fetchFn, tool: "Lemlist", limiter: opts.limiter ?? limiter, limiterKey: apiKey.slice(-12) };
    this.auth = { Authorization: `Basic ${Buffer.from(`:${apiKey}`).toString("base64")}` };
    this.sleep = opts.sleep ?? ((ms) => new Promise((r) => setTimeout(r, ms)));
  }

  private call<T>(method: string, path: string, body?: unknown) {
    return callJson<T>(this.o, method, `${LEMLIST_BASE}${path}`, { headers: this.auth, body });
  }

  async testConnection(): Promise<ConnectionResult> {
    try {
      const team = await this.call<{ name?: string }>("GET", "/team");
      return { ok: true, accountName: str(team?.name), webhooks: true };
    } catch (e) {
      if (e instanceof ToolError) {
        const reason = e.kind === "auth" || e.kind === "not_found" ? "Lemlist rejected the API key. Copy it again from Lemlist → Settings → Integrations → API." : e.message;
        return { ok: false, kind: e.kind === "not_found" ? "auth" : e.kind, reason };
      }
      throw e;
    }
  }

  async listCampaigns(): Promise<ToolCampaign[]> {
    const out: ToolCampaign[] = [];
    for (let page = 0; page < MAX_PAGES; page++) {
      const r = await this.call<unknown>("GET", `/campaigns?${new URLSearchParams({ version: "v2", limit: "100", offset: String(page * 100), sortBy: "createdAt", sortOrder: "desc" })}`);
      const list = (Array.isArray(r) ? r : ((r as { campaigns?: unknown[] } | null)?.campaigns ?? [])) as { _id: string; name?: string; status?: string }[];
      for (const c of list) if (c?._id && c.status !== "archived") out.push({ id: c._id, name: c.name ?? c._id, status: STATUS[c.status ?? ""] ?? c.status ?? "Unknown" });
      if (list.length < 100) break;
    }
    return out;
  }

  /** Lemlist variables live on each lead and are created with it. */
  async ensureVariables(): Promise<void> {}

  async pushLeads(campaignId: string, leads: PushLead[]): Promise<PushOutcome[]> {
    if (leads.length > this.batchSize) throw new Error(`At most ${this.batchSize} leads per call`);
    const out: PushOutcome[] = [];
    for (const l of leads) out.push(await this.pushOne(campaignId, l));
    return out;
  }

  private async pushOne(campaignId: string, l: PushLead): Promise<PushOutcome> {
    const body: Record<string, string> = { email: l.email };
    if (l.first_name) body.firstName = l.first_name;
    if (l.last_name) body.lastName = l.last_name;
    if (l.company) body.companyName = l.company;
    if (l.title) body.jobTitle = l.title;
    for (const [k, v] of Object.entries(l.variables)) body[k] = v;
    // fillEmptyOnly: don't overwrite the customer's existing contact/company data in Lemlist.
    const path = `/campaigns/${encodeURIComponent(campaignId)}/leads/?${new URLSearchParams({ deduplicate: "false", updateStrategy: "fillEmptyOnly" })}`;
    for (let attempt = 1; ; attempt++) {
      try {
        const r = await this.call<{ _id?: string }>("POST", path, body);
        return { ref: l.ref, status: "added", toolLeadId: r?._id };
      } catch (e) {
        if (!(e instanceof ToolError)) throw e;
        if (e.retryable && attempt < LEAD_TRIES) {
          await this.sleep(e.retryAfterMs ?? 1000 * 2 ** attempt);
          continue;
        }
        if (e.retryable) throw e; // the whole batch is retried later; leads already created come back as duplicates
        if (e.kind === "invalid" && /already in the campaign/i.test(e.message)) return { ref: l.ref, status: "skipped", reason: "Skipped by Lemlist: already in this campaign", duplicate: true };
        if (e.kind === "invalid" && /already in other campaign/i.test(e.message)) return { ref: l.ref, status: "skipped", reason: "Skipped by Lemlist: already in another campaign" };
        if (e.kind === "invalid" && /graveyard/i.test(e.message)) return { ref: l.ref, status: "skipped", reason: "Skipped by Lemlist: the address is in Lemlist's bounce graveyard" };
        if (e.kind === "invalid") return { ref: l.ref, status: "failed", reason: `Lemlist: ${e.message}` };
        throw e; // auth, permission, plan, campaign not found: stop the push with the reason
      }
    }
  }

  /** One hook per event type; a target URL can only be registered once in Lemlist, so each gets its own suffix. */
  async setupWebhooks(url: string): Promise<{ ok: true; ids: string[] } | { ok: false; reason: string }> {
    const ids: string[] = [];
    try {
      for (const type of Object.keys(LEMLIST_EVENTS)) {
        const r = await this.call<{ _id?: string }>("POST", "/hooks", { targetUrl: `${url}?event=${type}`, type });
        if (r?._id) ids.push(r._id);
      }
      return { ok: true, ids };
    } catch (e) {
      await this.removeWebhooks(ids);
      if (e instanceof ToolError) return { ok: false, reason: e.kind === "scope" ? "The Lemlist user of this key needs the \"Edit integrations\" permission for webhooks." : e.message };
      throw e;
    }
  }

  async removeWebhooks(ids: string[]): Promise<void> {
    for (const id of ids) await this.call("DELETE", `/hooks/${encodeURIComponent(id)}`).catch(() => {});
  }

  handleWebhook(body: unknown): ToolEvent[] {
    if (!body || typeof body !== "object") return [];
    const b = body as Record<string, unknown>;
    const type = LEMLIST_EVENTS[String(b.type)];
    if (!type || b.isThirdPartyReply === true) return [];
    const to = Array.isArray(b.to) ? (b.to[0] as { address?: unknown } | undefined)?.address : null;
    const email = str(b.leadEmail ?? b.email ?? to);
    const campaign = str(b.campaignId);
    if (!email || !campaign) return [];
    const step = typeof b.sequenceStep === "number" ? b.sequenceStep + 1 : null;
    return [{ type, toolCampaignId: campaign, email: email.toLowerCase(), at: str(b.createdAt) ?? new Date().toISOString(), step }];
  }

  async pollStatus(campaignId: string): Promise<ToolEvent[]> {
    const out: ToolEvent[] = [];
    const since = new Date(Date.now() - 60 * 86_400_000).toISOString();
    for (const type of POLL_TYPES) {
      for (let page = 0; page < MAX_PAGES; page++) {
        const q = new URLSearchParams({ version: "v2", type, campaignId, offset: String(page * 100), limit: "100", minDate: since });
        const r = await this.call<unknown>("GET", `/activities?${q}`);
        const list = (Array.isArray(r) ? r : []) as Record<string, unknown>[];
        for (const a of list) out.push(...this.handleWebhook({ ...a, type: a.type ?? type, campaignId: a.campaignId ?? campaignId }));
        if (list.length < 100) break;
      }
    }
    return out;
  }
}
