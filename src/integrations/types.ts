// Sending-tool adapters (§8 Lane B): one interface, one implementation per tool, plus a fake for tests.
// Framework-agnostic: no Next.js, no pg-boss. HTTP goes through an injectable fetch.

export const PROVIDERS = ["instantly", "smartlead", "lemlist"] as const;
export type Provider = (typeof PROVIDERS)[number];
export const PROVIDER_NAMES: Record<Provider, string> = { instantly: "Instantly", smartlead: "Smartlead", lemlist: "Lemlist" };
export const LIVE_PROVIDERS: Provider[] = ["instantly"];

export type ToolCampaign = { id: string; name: string; status: string };

/** One lead as sent to a tool: core fields plus custom variables (strings only). */
export type PushLead = {
  ref: string; // our push_item id (never sent unless the tool echoes it)
  email: string;
  first_name: string | null;
  last_name: string | null;
  company: string | null;
  title: string | null;
  website: string | null;
  variables: Record<string, string>;
};

export type PushOutcome = { ref: string; status: "added" | "skipped" | "failed"; reason?: string; toolLeadId?: string };

export type ToolEventType = "sent" | "replied" | "bounced" | "unsubscribed";
export type ToolEvent = { type: ToolEventType; toolCampaignId: string; email: string; at: string; step?: number | null };

export type ConnectionResult =
  | { ok: true; accountName: string | null; webhooks: boolean; webhooksReason?: string }
  | { ok: false; kind: ToolErrorKind; reason: string };

export type ToolErrorKind = "auth" | "plan" | "scope" | "rate_limit" | "invalid" | "not_found" | "transient";

/** Every adapter failure is one of these, with a message safe to show to the user (no keys, no URLs). */
export class ToolError extends Error {
  constructor(
    readonly kind: ToolErrorKind,
    message: string,
    readonly retryAfterMs?: number,
  ) {
    super(message);
  }
  get retryable() {
    return this.kind === "rate_limit" || this.kind === "transient";
  }
}

export interface SendingTool {
  readonly provider: Provider;
  /** Max leads per pushLeads call. */
  readonly batchSize: number;
  testConnection(): Promise<ConnectionResult>;
  listCampaigns(): Promise<ToolCampaign[]>;
  /** Make the variables known on the campaign before leads use them. */
  ensureVariables(campaignId: string, names: string[]): Promise<void>;
  /** Add leads; skip ones already in the campaign. idempotencyKey makes a retried call safe. */
  pushLeads(campaignId: string, leads: PushLead[], opts: { idempotencyKey: string }): Promise<PushOutcome[]>;
  /** Register our webhook URL for the events we track; returns the tool's webhook ids. */
  setupWebhooks(url: string): Promise<{ ok: true; ids: string[] } | { ok: false; reason: string }>;
  removeWebhooks(ids: string[]): Promise<void>;
  /** Parse a webhook body into events (unknown events: []). Never returns reply text. */
  handleWebhook(body: unknown): ToolEvent[];
  /** For plans without webhooks: replied / bounced / unsubscribed leads in a campaign. */
  pollStatus(campaignId: string): Promise<ToolEvent[]>;
}

export type FetchLike = (url: string, init?: { method?: string; headers?: Record<string, string>; body?: string; signal?: AbortSignal }) => Promise<{
  status: number;
  headers: { get(name: string): string | null };
  text(): Promise<string>;
}>;
