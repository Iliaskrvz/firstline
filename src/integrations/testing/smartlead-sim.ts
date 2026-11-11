// An in-memory Smartlead API (shapes from api.smartlead.ai, 2026-11-11), used as SmartleadTool's fetch in tests.
import type { FetchLike } from "../types";

type Lead = { id: number; email: string; campaign: string; custom_fields?: Record<string, string>; replied?: boolean; bounced?: boolean; unsubscribed?: boolean };

export type SmartleadSimOptions = {
  key?: string;
  blocklist?: string[];
  /** How skipped leads are reported: the docs don't show the item shape. */
  skippedShape?: "objects" | "strings" | "none";
  rateLimitTimes?: number;
  webhooksForbidden?: boolean;
};

export function smartleadSim(opts: SmartleadSimOptions = {}) {
  const key = opts.key ?? "sl-test-key";
  const state = {
    campaigns: [
      { id: 3001, name: "Bakeries Utrecht", status: "DRAFTED" },
      { id: 3002, name: "Agencies NL", status: "ACTIVE" },
      { id: 3003, name: "Old", status: "ARCHIVED" },
    ],
    leads: [] as Lead[],
    webhooks: [] as { id: number; webhook_url: string; email_campaign_id: number | string; event_type_map: Record<string, boolean> }[],
    nextWebhook: 1,
    requests: [] as { method: string; path: string; query: Record<string, string>; body: unknown }[],
    rateLimitTimes: opts.rateLimitTimes ?? 0,
  };
  const json = (status: number, body: unknown, headers: Record<string, string> = {}) => ({
    status,
    headers: { get: (n: string) => headers[n.toLowerCase()] ?? null },
    text: async () => (typeof body === "string" ? body : JSON.stringify(body)),
  });

  const fetchFn: FetchLike = async (url, init = {}) => {
    const u = new URL(url);
    const path = u.pathname.replace(/^\/api\/v1/, "");
    const method = init.method ?? "GET";
    const body = init.body ? JSON.parse(init.body) : undefined;
    const query = Object.fromEntries(u.searchParams);
    state.requests.push({ method, path, query, body });
    if (query.api_key !== key) return json(401, { message: "Invalid API Key" });
    if (state.rateLimitTimes > 0) {
      state.rateLimitTimes--;
      return json(429, { error: { code: "RATE_LIMIT_EXCEEDED", message: "Too many requests", retry_after: 2 } });
    }
    if (method === "GET" && path === "/campaigns/") return json(200, state.campaigns.map((c) => ({ ...c, user_id: 1, created_at: "2026-11-01T00:00:00Z" })));

    const add = path.match(/^\/campaigns\/(\d+)\/leads$/);
    if (add && method === "POST") {
      if (!state.campaigns.some((c) => String(c.id) === add[1])) return json(404, { message: "Campaign not found" });
      if (!Array.isArray(body.lead_list) || body.lead_list.length > 400) return json(400, { message: "lead_list must have 1-400 items" });
      const skipped: { email: string; reason: string }[] = [];
      let added = 0;
      for (const l of body.lead_list as { email: string; custom_fields?: Record<string, string> }[]) {
        const email = l.email.toLowerCase();
        if ((opts.blocklist ?? []).includes(email)) skipped.push({ email, reason: "Lead is in global block list" });
        else if (state.leads.some((x) => x.campaign === add[1] && x.email === email)) skipped.push({ email, reason: "Lead already exists in campaign" });
        else {
          state.leads.push({ id: state.leads.length + 1, email, campaign: add[1], custom_fields: l.custom_fields });
          added++;
        }
      }
      const shape = opts.skippedShape ?? "objects";
      return json(200, {
        success: true,
        message: "Leads added successfully",
        added_count: added,
        skipped_count: skipped.length,
        skipped_leads: shape === "objects" ? skipped : shape === "strings" ? skipped.map((s) => s.email) : [],
      });
    }
    if (add && method === "GET") {
      const all = state.leads.filter((l) => l.campaign === add[1]).filter((l) =>
        query.emailStatus === "is_replied" ? l.replied : query.emailStatus === "is_bounced" ? l.bounced : query.emailStatus === "is_unsubscribed" ? l.unsubscribed : true,
      );
      const offset = Number(query.offset ?? 0);
      const limit = Math.min(Number(query.limit ?? 100), 100);
      return json(200, {
        total_leads: String(all.length),
        offset,
        limit,
        data: all.slice(offset, offset + limit).map((l) => ({ campaign_lead_map_id: l.id, status: "INPROGRESS", lead: { id: l.id, email: l.email, custom_fields: l.custom_fields, is_unsubscribed: !!l.unsubscribed } })),
      });
    }
    if (method === "POST" && path === "/webhook/create") {
      if (opts.webhooksForbidden) return json(403, { message: "Webhooks are not available on your plan" });
      const w = { id: 900 + state.nextWebhook++, webhook_url: body.webhook_url, email_campaign_id: body.email_campaign_id, event_type_map: body.event_type_map };
      state.webhooks.push(w);
      return json(200, { ok: true, id: w.id, webhook_url: w.webhook_url });
    }
    const del = path.match(/^\/webhook\/delete\/(\d+)$/);
    if (del && method === "DELETE") {
      state.webhooks = state.webhooks.filter((w) => String(w.id) !== del[1]);
      return json(200, { ok: true });
    }
    return json(404, { message: `No route ${method} ${path}` });
  };
  return { fetch: fetchFn, state, key };
}

/** A webhook body as Smartlead sends it (events reference). */
export function smartleadWebhook(event_type: string, email: string, campaign_id: number | string, extra: Record<string, unknown> = {}) {
  const base = { event_type, campaign_id: Number.isFinite(Number(campaign_id)) ? Number(campaign_id) : campaign_id, campaign_name: "Bakeries Utrecht", sequence_number: 1, from_email: "tom@getacme.com", to_email: email, to_name: "Sanne" };
  if (event_type === "LEAD_UNSUBSCRIBED") return { event_type, campaign_id: Number.isFinite(Number(campaign_id)) ? Number(campaign_id) : campaign_id, lead_email: email, lead_name: "Sanne", ...extra };
  return { ...base, ...extra };
}
