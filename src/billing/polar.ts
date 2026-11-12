// Polar (merchant of record): hosted checkout and signed webhooks, on @polar-sh/sdk (API 2026-10).
// Framework-agnostic: the checkout client is passed in, so tests and fake mode need no Polar account.
// Paid orders don't grant credits yet: see the TODOs in handlePolarEvent and POLAR_SETUP.md.
import { webhooks, type Environment } from "@polar-sh/sdk/2026-10";

/** POLAR_SERVER: "production" (default) or "sandbox". Sandbox and production need separate tokens. */
export function polarEnvironment(env: Record<string, string | undefined> = process.env): Environment {
  return env.POLAR_SERVER?.trim() === "sandbox" ? "sandbox" : "production";
}

/** The part of the SDK we use (polar.checkouts.create). Field names are the API's (snake_case). */
export type PolarCheckouts = {
  create(body: { products: string[]; external_customer_id?: string; customer_email?: string; customer_ip_address?: string }): Promise<{ id: string; url: string }>;
};

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** ?products=<id>[,<id>…] (or the parameter repeated): Polar product ids, first one selected by default. */
export function parseProductIds(values: string[]): string[] | null {
  const ids = values.flatMap((v) => v.split(",")).map((s) => s.trim()).filter(Boolean);
  if (ids.length === 0 || ids.length > 10 || !ids.every((id) => UUID.test(id))) return null;
  return [...new Set(ids)];
}

export async function createPolarCheckout(
  checkouts: PolarCheckouts,
  input: { products: string[]; userId?: string | null; email?: string | null; ip?: string | null },
): Promise<string> {
  const { url } = await checkouts.create({
    products: input.products,
    // Lets the webhook find the FirstLine user again (order.customer.external_id).
    ...(input.userId ? { external_customer_id: input.userId } : {}),
    ...(input.email ? { customer_email: input.email } : {}),
    ...(input.ip ? { customer_ip_address: input.ip } : {}),
  });
  if (!url) throw new Error("Polar didn't return a checkout link.");
  return url;
}

/**
 * Fake mode (no POLAR_ACCESS_TOKEN outside production, or POLAR_ACCESS_TOKEN=fake-polar): no network,
 * the "checkout" is a page on this app that says so. Same shape as the real response.
 */
export function fakePolarCheckouts(origin: string): PolarCheckouts & { calls: Parameters<PolarCheckouts["create"]>[0][] } {
  const calls: Parameters<PolarCheckouts["create"]>[0][] = [];
  return {
    calls,
    async create(body) {
      calls.push(body);
      const id = `fake_${calls.length}`;
      return { id, url: `${origin}/credits?fake_checkout=${id}` };
    },
  };
}

export type PolarEvent = Awaited<ReturnType<typeof webhooks.validateEvent>>;

/**
 * Check a webhook really comes from Polar (Standard Webhooks: HMAC-SHA256 over "id.timestamp.body",
 * timestamp within 5 minutes). Throws webhooks.PolarWebhookVerificationError on a bad signature and
 * webhooks.PolarWebhookUnknownTypeError on an event type this SDK version doesn't know.
 */
export function verifyPolarWebhook(rawBody: string, headers: Record<string, string>, secret: string): Promise<PolarEvent> {
  return webhooks.validateEvent(rawBody, headers, secret);
}

export type PolarEventResult = { type: string; handled: boolean; note: string };

/** What to do with each verified event. Only stubs for now: nothing is credited yet. */
export async function handlePolarEvent(event: PolarEvent): Promise<PolarEventResult> {
  switch (event.type) {
    case "order.paid":
      // TODO(polar): turn a paid order into credits, once per order (ledger key `polar:<order id>`):
      // resolve the workspace from event.data.metadata / event.data.customer.external_id and the pack
      // from event.data.product_id. Mapping proposed in POLAR_SETUP.md; build it after approval.
      return { type: event.type, handled: false, note: `order ${event.data.id} paid: not credited yet (TODO)` };
    case "customer.state_changed":
      // TODO(polar): nothing to sync yet. FirstLine sells one-time packs, no subscriptions or benefits.
      return { type: event.type, handled: false, note: "customer state changed: nothing to sync yet (TODO)" };
    default:
      return { type: event.type, handled: false, note: "ignored event type" };
  }
}
