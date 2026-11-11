// An in-memory Instantly API v2, answering with the response shapes from developer.instantly.ai
// (recorded from the docs, 2026-11-11). Used as the fetch of InstantlyTool in tests: no network.
import type { FetchLike } from "../types";

type Lead = { id: string; email: string; campaign: string; status: number; custom_variables?: Record<string, unknown>; timestamp_updated: string; timestamp_last_reply?: string };

export type InstantlySimOptions = { key?: string; plan?: "paid" | "unpaid" | "no-webhooks"; rateLimitTimes?: number; blocklist?: string[] };

export function instantlySim(opts: InstantlySimOptions = {}) {
  const key = opts.key ?? "test-key";
  const state = {
    campaigns: [
      { id: "11111111-1111-4111-8111-111111111111", name: "Q4 outreach", status: 0 },
      { id: "22222222-2222-4222-8222-222222222222", name: "Agencies NL", status: 1 },
    ],
    variables: new Map<string, string[]>(),
    leads: [] as Lead[],
    webhooks: [] as { id: string; target_hook_url: string; event_type: string }[],
    idem: new Map<string, unknown>(),
    requests: [] as { method: string; path: string; body: unknown; auth: string | undefined }[],
    rateLimitTimes: opts.rateLimitTimes ?? 0,
    nextWebhook: 1,
  };
  const json = (status: number, body: unknown, headers: Record<string, string> = {}) => ({
    status,
    headers: { get: (n: string) => headers[n.toLowerCase()] ?? null },
    text: async () => JSON.stringify(body),
  });

  const fetchFn: FetchLike = async (url, init = {}) => {
    const u = new URL(url);
    const path = u.pathname.replace(/^\/api\/v2/, "");
    const method = init.method ?? "GET";
    const body = init.body ? JSON.parse(init.body) : undefined;
    state.requests.push({ method, path: path + u.search, body, auth: init.headers?.Authorization });
    if (init.headers?.Authorization !== `Bearer ${key}`) return json(401, { statusCode: 401, error: "Unauthorized", message: "Invalid API key" });
    if (opts.plan === "unpaid") return json(402, { statusCode: 402, error: "Payment Required", message: "Workspace does not have an active paid plan" });
    if (state.rateLimitTimes > 0 && method === "POST" && path === "/leads/add") {
      state.rateLimitTimes--;
      return json(429, { statusCode: 429, error: "Too Many Requests", message: "Rate limit exceeded" });
    }

    if (method === "GET" && path === "/workspaces/current") return json(200, { id: "ws_1", name: "Acme Outreach", plan_id: "pid_growth" });
    if (path.startsWith("/webhooks") && opts.plan === "no-webhooks") return json(402, { statusCode: 402, error: "Payment Required", message: "Upgrade to use webhooks" });
    if (method === "GET" && path === "/webhooks") return json(200, { items: state.webhooks.slice(0, Number(u.searchParams.get("limit") ?? 100)), next_starting_after: null });
    if (method === "POST" && path === "/webhooks") {
      const w = { id: `wh_${state.nextWebhook++}`, target_hook_url: body.target_hook_url, event_type: body.event_type };
      state.webhooks.push(w);
      return json(200, { ...w, campaign: body.campaign, name: body.name });
    }
    if (method === "DELETE" && path.startsWith("/webhooks/")) {
      state.webhooks = state.webhooks.filter((w) => w.id !== path.split("/")[2]);
      return json(200, {});
    }
    if (method === "GET" && path === "/campaigns") {
      const limit = Number(u.searchParams.get("limit") ?? 100);
      const after = u.searchParams.get("starting_after");
      const start = after ? state.campaigns.findIndex((c) => c.id === after) + 1 : 0;
      const items = state.campaigns.slice(start, start + limit);
      return json(200, { items, next_starting_after: start + limit < state.campaigns.length ? items.at(-1)?.id : null });
    }
    const vm = path.match(/^\/campaigns\/([^/]+)\/variables$/);
    if (method === "POST" && vm) {
      const c = state.campaigns.find((x) => x.id === vm[1]);
      if (!c) return json(404, { statusCode: 404, message: "Campaign not found" });
      state.variables.set(c.id, [...new Set([...(state.variables.get(c.id) ?? []), ...body.variables])]);
      return json(200, c);
    }
    if (method === "POST" && path === "/leads/add") {
      if (body.idempotency_key && state.idem.has(body.idempotency_key)) return json(200, state.idem.get(body.idempotency_key));
      if (!state.campaigns.some((c) => c.id === body.campaign_id)) return json(404, { statusCode: 404, message: "Campaign not found" });
      if (body.leads.length > 1000) return json(400, { statusCode: 400, message: "body/leads must NOT have more than 1000 items" });
      const created: { index: number; id: string; email: string }[] = [];
      let dup = 0, blocked = 0, invalid = 0;
      body.leads.forEach((l: { email: string; custom_variables?: Record<string, unknown> }, index: number) => {
        const email = l.email.toLowerCase();
        if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return void invalid++;
        if ((opts.blocklist ?? []).includes(email)) return void blocked++;
        if (body.skip_if_in_campaign && state.leads.some((x) => x.campaign === body.campaign_id && x.email === email)) return void dup++;
        const lead: Lead = { id: `lead_${state.leads.length + 1}`, email, campaign: body.campaign_id, status: 1, custom_variables: l.custom_variables, timestamp_updated: "2026-11-11T10:00:00.000Z" };
        state.leads.push(lead);
        created.push({ index, id: lead.id, email });
      });
      const res = {
        status: "success",
        total_sent: body.leads.length,
        leads_uploaded: created.length,
        in_blocklist: blocked,
        blocklist_used: null,
        duplicated_leads: dup,
        skipped_count: dup + blocked,
        invalid_email_count: invalid,
        incomplete_count: 0,
        duplicate_email_count: 0,
        remaining_in_plan: 10000,
        created_leads: created,
      };
      if (body.idempotency_key) state.idem.set(body.idempotency_key, res);
      return json(200, res);
    }
    if (method === "POST" && path === "/leads/list") {
      const want: Record<string, (l: Lead) => boolean> = {
        FILTER_VAL_CONTACTED: (l) => l.status !== 1 || !!l.timestamp_last_reply,
        FILTER_VAL_REPLIED: (l) => !!l.timestamp_last_reply,
        FILTER_VAL_BOUNCED: (l) => l.status === -1,
        FILTER_VAL_UNSUBSCRIBED: (l) => l.status === -2,
      };
      const f = want[body.filter] ?? (() => true);
      const all = state.leads.filter((l) => l.campaign === body.campaign && f(l));
      const start = body.starting_after ? all.findIndex((l) => l.id === body.starting_after) + 1 : 0;
      const items = all.slice(start, start + (body.limit ?? 100));
      return json(200, { items, next_starting_after: start + items.length < all.length ? items.at(-1)?.id : null });
    }
    return json(404, { statusCode: 404, message: `No route ${method} ${path}` });
  };
  return { fetch: fetchFn, state };
}

/** A webhook body as Instantly sends it (fields from the webhook-events guide). */
export function instantlyWebhook(event_type: string, lead_email: string, campaign_id: string, extra: Record<string, unknown> = {}) {
  return {
    timestamp: "2026-11-11T12:00:00.000Z",
    event_type,
    workspace: "ws_1",
    campaign_id,
    campaign_name: "Q4 outreach",
    lead_email,
    email_account: "tom@getacme.com",
    unibox_url: "https://app.instantly.ai/app/unibox?lead=x",
    step: 1,
    variant: 1,
    is_first: true,
    ...extra,
  };
}
