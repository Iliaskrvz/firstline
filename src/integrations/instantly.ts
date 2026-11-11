// Instantly API v2 adapter (developer.instantly.ai, checked 2026-11-11).
// Auth: Authorization: Bearer <v2 key>. Leads: POST /leads/add (≤ 1,000, custom_variables, idempotency_key).
// Variables: POST /campaigns/{id}/variables before leads use them. Webhooks are unsigned and carry no
// event id: our URL holds a secret token and events are de-duplicated on our side.
import { ToolError, type ConnectionResult, type FetchLike, type PushLead, type PushOutcome, type SendingTool, type ToolCampaign, type ToolEvent, type ToolEventType } from "./types";

export const INSTANTLY_BASE = "https://api.instantly.ai/api/v2";

const CAMPAIGN_STATUS: Record<string, string> = { "0": "Draft", "1": "Active", "2": "Paused", "3": "Completed", "4": "Running subsequences", "-99": "Suspended", "-1": "Accounts unhealthy", "-2": "Bounce protect" };

const WEBHOOK_EVENTS: Record<string, ToolEventType> = {
  email_sent: "sent",
  reply_received: "replied",
  email_bounced: "bounced",
  lead_unsubscribed: "unsubscribed",
};

const POLL_FILTERS: { filter: string; type: ToolEventType; at: (l: Record<string, unknown>) => unknown }[] = [
  { filter: "FILTER_VAL_CONTACTED", type: "sent", at: (l) => l.timestamp_last_contact ?? l.timestamp_updated },
  { filter: "FILTER_VAL_REPLIED", type: "replied", at: (l) => l.timestamp_last_reply ?? l.timestamp_updated },
  { filter: "FILTER_VAL_BOUNCED", type: "bounced", at: (l) => l.timestamp_updated },
  { filter: "FILTER_VAL_UNSUBSCRIBED", type: "unsubscribed", at: (l) => l.timestamp_updated },
];

const MAX_PAGES = 50;
const str = (v: unknown) => (typeof v === "string" && v.trim() ? v.trim() : null);

export class InstantlyTool implements SendingTool {
  readonly provider = "instantly" as const;
  readonly batchSize = 1000;
  readonly webhookMode = "account" as const;

  constructor(
    private readonly apiKey: string,
    private readonly fetchFn: FetchLike = fetch as unknown as FetchLike,
    private readonly timeoutMs = 30_000,
  ) {}

  private async call<T>(method: string, path: string, body?: unknown): Promise<T> {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), this.timeoutMs);
    let res: Awaited<ReturnType<FetchLike>>;
    let text: string;
    try {
      res = await this.fetchFn(`${INSTANTLY_BASE}${path}`, {
        method,
        headers: { Authorization: `Bearer ${this.apiKey}`, ...(body !== undefined ? { "Content-Type": "application/json" } : {}) },
        body: body !== undefined ? JSON.stringify(body) : undefined,
        signal: ctrl.signal,
      });
      text = await res.text();
    } catch (e) {
      throw new ToolError("transient", (e as Error).name === "AbortError" ? "Instantly did not answer in time." : "Could not reach Instantly.");
    } finally {
      clearTimeout(timer);
    }
    if (res.status >= 200 && res.status < 300) {
      try {
        return (text ? JSON.parse(text) : {}) as T;
      } catch {
        throw new ToolError("transient", "Instantly sent an unreadable answer.");
      }
    }
    let message = "";
    try {
      const j = JSON.parse(text) as { message?: unknown; error?: unknown };
      message = String(j.message ?? j.error ?? "").slice(0, 200);
    } catch {
      /* not JSON */
    }
    switch (res.status) {
      case 401:
        throw new ToolError("auth", "Instantly rejected the API key. Check that it is an API v2 key and not revoked.");
      case 402:
        throw new ToolError("plan", "Your Instantly workspace has no active paid plan that includes the API.");
      case 403:
        throw new ToolError("scope", "The API key is missing a permission for this. Create a key with the all:all scope (or leads, campaigns and webhooks).");
      case 404:
        throw new ToolError("not_found", message || "Not found in Instantly.");
      case 429: {
        const ra = Number(res.headers.get("retry-after"));
        throw new ToolError("rate_limit", "Instantly rate limit reached.", Number.isFinite(ra) && ra > 0 ? ra * 1000 : 2000);
      }
      default:
        if (res.status >= 500) throw new ToolError("transient", `Instantly had an error (${res.status}).`);
        throw new ToolError("invalid", message || `Instantly refused the request (${res.status}).`);
    }
  }

  async testConnection(): Promise<ConnectionResult> {
    let accountName: string | null;
    try {
      const ws = await this.call<{ name?: string }>("GET", "/workspaces/current");
      accountName = str(ws.name);
    } catch (e) {
      if (e instanceof ToolError) return { ok: false, kind: e.kind, reason: e.message };
      throw e;
    }
    try {
      await this.call("GET", "/webhooks?limit=1");
      return { ok: true, accountName, webhooks: true };
    } catch (e) {
      if (e instanceof ToolError && (e.kind === "plan" || e.kind === "scope" || e.kind === "not_found")) {
        return { ok: true, accountName, webhooks: false, webhooksReason: e.kind === "scope" ? "The key can't manage webhooks." : "Your Instantly plan doesn't include webhooks." };
      }
      if (e instanceof ToolError) return { ok: false, kind: e.kind, reason: e.message };
      throw e;
    }
  }

  async listCampaigns(): Promise<ToolCampaign[]> {
    const out: ToolCampaign[] = [];
    let after: string | null = null;
    for (let page = 0; page < MAX_PAGES; page++) {
      const q = new URLSearchParams({ limit: "100" });
      if (after) q.set("starting_after", after);
      const r: { items?: { id: string; name?: string; status?: number }[]; next_starting_after?: string | null } = await this.call("GET", `/campaigns?${q}`);
      for (const c of r.items ?? []) out.push({ id: c.id, name: c.name ?? c.id, status: CAMPAIGN_STATUS[String(c.status)] ?? "Unknown" });
      after = r.next_starting_after ?? null;
      if (!after || !r.items?.length) break;
    }
    return out;
  }

  async ensureVariables(campaignId: string, names: string[]): Promise<void> {
    if (!names.length) return;
    await this.call("POST", `/campaigns/${encodeURIComponent(campaignId)}/variables`, { variables: names });
  }

  async pushLeads(campaignId: string, leads: PushLead[], opts: { idempotencyKey: string }): Promise<PushOutcome[]> {
    if (leads.length > this.batchSize) throw new Error(`At most ${this.batchSize} leads per call`);
    const body = {
      campaign_id: campaignId,
      skip_if_in_campaign: true,
      idempotency_key: opts.idempotencyKey.slice(0, 128),
      leads: leads.map((l) => {
        const o: Record<string, unknown> = { email: l.email };
        if (l.first_name) o.first_name = l.first_name;
        if (l.last_name) o.last_name = l.last_name;
        if (l.company) o.company_name = l.company;
        if (l.website) o.website = l.website;
        if (l.title) o.job_title = l.title;
        if (Object.keys(l.variables).length) o.custom_variables = l.variables;
        return o;
      }),
    };
    const r = await this.call<{
      created_leads?: { index?: number; id?: string; email?: string }[];
      in_blocklist?: number;
      duplicated_leads?: number;
      duplicate_email_count?: number;
      invalid_email_count?: number;
      incomplete_count?: number;
      skipped_count?: number;
      remaining_in_plan?: number;
    }>("POST", "/leads/add", body);

    const created = new Map<number, string | undefined>();
    const byEmail = new Map<string, string | undefined>();
    for (const c of r.created_leads ?? []) {
      if (typeof c.index === "number") created.set(c.index, c.id);
      else if (c.email) byEmail.set(c.email.toLowerCase(), c.id);
    }
    const reasons = [
      [r.duplicated_leads, "already in this campaign"],
      [r.duplicate_email_count, "duplicate email in the upload"],
      [r.in_blocklist, "on your Instantly blocklist"],
      [r.invalid_email_count, "invalid email address"],
      [r.incomplete_count, "missing required fields"],
    ].filter(([n]) => typeof n === "number" && n > 0) as [number, string][];
    const skippedReason =
      reasons.length === 1 ? `Skipped by Instantly: ${reasons[0][1]}`
      : reasons.length > 1 ? `Skipped by Instantly (${reasons.map(([n, t]) => `${n} ${t}`).join(", ")})`
      : r.remaining_in_plan === 0 ? "Skipped by Instantly: your plan's lead limit is reached"
      : "Skipped by Instantly";

    return leads.map((l, i) => {
      if (created.has(i)) return { ref: l.ref, status: "added", toolLeadId: created.get(i) };
      const e = l.email.toLowerCase();
      if (byEmail.has(e)) return { ref: l.ref, status: "added", toolLeadId: byEmail.get(e) };
      return { ref: l.ref, status: "skipped", reason: skippedReason, ...(reasons.length === 1 && reasons[0][1] === "already in this campaign" ? { duplicate: true } : {}) };
    });
  }

  async setupWebhooks(url: string): Promise<{ ok: true; ids: string[] } | { ok: false; reason: string }> {
    const ids: string[] = [];
    try {
      for (const event_type of Object.keys(WEBHOOK_EVENTS)) {
        const r = await this.call<{ id?: string }>("POST", "/webhooks", { target_hook_url: url, campaign: null, name: `FirstLine ${event_type}`, event_type });
        if (r.id) ids.push(r.id);
      }
      return { ok: true, ids };
    } catch (e) {
      await this.removeWebhooks(ids);
      if (e instanceof ToolError) return { ok: false, reason: e.message };
      throw e;
    }
  }

  async removeWebhooks(ids: string[]): Promise<void> {
    for (const id of ids) await this.call("DELETE", `/webhooks/${encodeURIComponent(id)}`).catch(() => {});
  }

  handleWebhook(body: unknown): ToolEvent[] {
    if (!body || typeof body !== "object") return [];
    const b = body as Record<string, unknown>;
    const type = WEBHOOK_EVENTS[String(b.event_type)];
    const email = str(b.lead_email);
    const campaign = str(b.campaign_id);
    if (!type || !email || !campaign) return [];
    const step = typeof b.step === "number" ? b.step : null;
    // Only these fields are kept: reply text, subject and HTML in the payload are ignored on purpose.
    return [{ type, toolCampaignId: campaign, email: email.toLowerCase(), at: str(b.timestamp) ?? new Date().toISOString(), step }];
  }

  async pollStatus(campaignId: string): Promise<ToolEvent[]> {
    const out: ToolEvent[] = [];
    for (const { filter, type, at } of POLL_FILTERS) {
      let after: string | null = null;
      for (let page = 0; page < MAX_PAGES; page++) {
        const r: { items?: Record<string, unknown>[]; next_starting_after?: string | null } = await this.call("POST", "/leads/list", {
          campaign: campaignId,
          filter,
          limit: 100,
          ...(after ? { starting_after: after } : {}),
        });
        for (const l of r.items ?? []) {
          const email = str(l.email);
          if (email) out.push({ type, toolCampaignId: campaignId, email: email.toLowerCase(), at: str(at(l)) ?? new Date().toISOString() });
        }
        after = r.next_starting_after ?? null;
        if (!after || !r.items?.length) break;
      }
    }
    return out;
  }
}
