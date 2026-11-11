// An in-memory Lemlist API (shapes from developer.lemlist.com, 2026-11-11), used as LemlistTool's fetch in tests.
import type { FetchLike } from "../types";

type Lead = { _id: string; email: string; campaignId: string; vars: Record<string, string> };
type Activity = { _id: string; type: string; campaignId: string; leadEmail: string; createdAt: string };

export type LemlistSimOptions = {
  key?: string;
  /** "400" today; "409" from 1 Dec 2026. */
  duplicateStatus?: 400 | 409;
  graveyard?: string[];
  /** Answer 429 to the Nth POST lead call (1-based), once. */
  rateLimitAt?: number;
  noIntegrationsPermission?: boolean;
};

export function lemlistSim(opts: LemlistSimOptions = {}) {
  const key = opts.key ?? "lm-test-key";
  const state = {
    campaigns: [
      { _id: "cam_A1", name: "Bakeries Utrecht", status: "draft" },
      { _id: "cam_B2", name: "Agencies NL", status: "running" },
      { _id: "cam_Z9", name: "Old", status: "archived" },
    ],
    leads: [] as Lead[],
    hooks: [] as { _id: string; targetUrl: string; type?: string }[],
    activities: [] as Activity[],
    requests: [] as { method: string; path: string; query: Record<string, string>; body: unknown; auth?: string }[],
    leadPosts: 0,
    nextId: 1,
  };
  const res = (status: number, body: unknown, headers: Record<string, string> = {}) => ({
    status,
    headers: { get: (n: string) => headers[n.toLowerCase()] ?? null },
    text: async () => (typeof body === "string" ? body : JSON.stringify(body)),
  });

  const fetchFn: FetchLike = async (url, init = {}) => {
    const u = new URL(url);
    const path = u.pathname.replace(/^\/api/, "");
    const method = init.method ?? "GET";
    const body = init.body ? JSON.parse(init.body) : undefined;
    const query = Object.fromEntries(u.searchParams);
    state.requests.push({ method, path, query, body, auth: init.headers?.Authorization });
    if (init.headers?.Authorization !== `Basic ${Buffer.from(`:${key}`).toString("base64")}`) return res(401, "The authentication you supplied is incorrect");

    if (method === "GET" && path === "/team") return res(200, { _id: "tea_1", name: "Acme Growth", userIds: ["usr_1"], hooks: state.hooks });
    if (method === "GET" && path === "/campaigns") {
      const off = Number(query.offset ?? 0);
      return res(200, state.campaigns.slice(off, off + Number(query.limit ?? 100)));
    }
    const add = path.match(/^\/campaigns\/([^/]+)\/leads\/$/);
    if (add && method === "POST") {
      state.leadPosts++;
      if (opts.rateLimitAt && state.leadPosts === opts.rateLimitAt) return res(429, "Too Many Requests", { "retry-after": "1" });
      if (!state.campaigns.some((c) => c._id === add[1])) return res(404, "Campaign not found");
      const email = String(body.email).toLowerCase();
      if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return res(400, "Invalid email address");
      if ((opts.graveyard ?? []).includes(email)) return res(400, "Email address is in the graveyard");
      if (state.leads.some((l) => l.campaignId === add[1] && l.email === email)) return res(opts.duplicateStatus ?? 400, "Lead already in the campaign");
      const { email: _e, firstName, lastName, companyName, jobTitle, ...vars } = body;
      void _e;
      const lead: Lead = { _id: `lea_${state.nextId++}`, email, campaignId: add[1], vars: vars as Record<string, string> };
      state.leads.push(lead);
      return res(200, { campaignId: add[1], email, firstName, lastName, companyName, jobTitle, _id: lead._id, isPaused: false, contactId: "ctc_1", warnings: [] });
    }
    if (method === "POST" && path === "/hooks") {
      if (opts.noIntegrationsPermission) return res(403, { error: "Missing permission: Edit integrations" });
      if (state.hooks.some((h) => h.targetUrl === body.targetUrl)) return res(409, "A webhook with this targetUrl already exists");
      const h = { _id: `hoo_${state.nextId++}`, targetUrl: body.targetUrl, type: body.type };
      state.hooks.push(h);
      return res(200, { ...h, createdAt: "2026-11-11T10:00:00.000Z" });
    }
    const del = path.match(/^\/hooks\/([^/]+)$/);
    if (del && method === "DELETE") {
      const h = state.hooks.find((x) => x._id === del[1]);
      if (!h) return res(404, "Webhook not found");
      state.hooks = state.hooks.filter((x) => x !== h);
      return res(200, h);
    }
    if (method === "GET" && path === "/activities") {
      if (query.version !== "v2") return res(400, "version=v2 is required");
      const all = state.activities.filter((a) => a.type === query.type && (!query.campaignId || a.campaignId === query.campaignId));
      const off = Number(query.offset ?? 0);
      return res(200, all.slice(off, off + Math.min(Number(query.limit ?? 100), 100)));
    }
    return res(404, `No route ${method} ${path}`);
  };
  return { fetch: fetchFn, state, key };
}

/** A webhook body as Lemlist sends it (an activity record). */
export function lemlistWebhook(type: string, email: string, campaignId: string, extra: Record<string, unknown> = {}) {
  return {
    _id: `act_${Math.random().toString(36).slice(2, 10)}`,
    type,
    teamId: "tea_1",
    createdAt: "2026-11-12T09:00:00.000Z",
    campaignId,
    campaignName: "Bakeries Utrecht",
    sequenceStep: 0,
    leadId: "lea_1",
    leadEmail: email,
    leadFirstName: "Sanne",
    to: [{ address: email.toLowerCase(), name: "Sanne" }],
    ...extra,
  };
}
