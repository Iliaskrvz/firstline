// Polar (merchant of record: it sells the packs, charges and remits VAT, sends the invoice).
// Hosted checkout for a credit pack, and signed webhooks that turn a paid order into credits (§9),
// on @polar-sh/sdk (API 2026-10). Framework-agnostic: the checkout client and pg Pool are passed in,
// so tests and fake mode need no Polar account.
import { webhooks, type Environment } from "@polar-sh/sdk/2026-10";
import type pg from "pg";
import { PACKS, isPackId, type PackId } from "@/lib/credits";
import { logActivity } from "@/teams/db";
import { addPurchase } from "./db";

/** POLAR_SERVER: "production" (default) or "sandbox". Sandbox and production need separate tokens. */
export function polarEnvironment(env: Record<string, string | undefined> = process.env): Environment {
  return env.POLAR_SERVER?.trim() === "sandbox" ? "sandbox" : "production";
}

/** The part of the SDK we use (polar.checkouts.create). Field names are the API's (snake_case). */
export type PolarCheckoutBody = {
  products: string[];
  external_customer_id?: string;
  customer_email?: string;
  customer_ip_address?: string;
  success_url?: string;
  metadata?: Record<string, string | number | boolean>;
};
export type PolarCheckouts = { create(body: PolarCheckoutBody): Promise<{ id: string; url: string }> };

/** Polar product id per pack: POLAR_PRODUCT_<ID> (e.g. POLAR_PRODUCT_GROWTH, POLAR_PRODUCT_LITE_50K). */
export function polarProductIds(env: Record<string, string | undefined> = process.env): Partial<Record<PackId, string>> {
  const out: Partial<Record<PackId, string>> = {};
  for (const id of Object.keys(PACKS)) {
    const v = env[polarProductEnvName(id)]?.trim();
    if (v) out[id] = v;
  }
  return out;
}

export const polarProductEnvName = (pack: string) => `POLAR_PRODUCT_${pack.toUpperCase().replace(/-/g, "_")}`;

export function packForProduct(products: Partial<Record<PackId, string>>, productId: unknown): PackId | null {
  if (typeof productId !== "string") return null;
  return (Object.entries(products).find(([, id]) => id === productId)?.[0] as PackId | undefined) ?? null;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** ?products=<id>[,<id>…] (or the parameter repeated): Polar product ids, first one selected by default. */
export function parseProductIds(values: string[]): string[] | null {
  const ids = values.flatMap((v) => v.split(",")).map((s) => s.trim()).filter(Boolean);
  if (ids.length === 0 || ids.length > 10 || !ids.every((id) => UUID.test(id))) return null;
  return [...new Set(ids)];
}

export async function createPolarCheckout(
  checkouts: PolarCheckouts,
  input: { products: string[]; workspaceId?: string | null; email?: string | null; ip?: string | null },
): Promise<string> {
  const { url } = await checkouts.create({
    products: input.products,
    // The workspace is the paying customer: the webhook finds it again in order.customer.external_id.
    ...(input.workspaceId ? { external_customer_id: input.workspaceId } : {}),
    ...(input.email ? { customer_email: input.email } : {}),
    ...(input.ip ? { customer_ip_address: input.ip } : {}),
  });
  if (!url) throw new Error("Polar didn't return a checkout link.");
  return url;
}

/** Checkout for a credit pack from the Credits page: the pack's product, the workspace as customer. */
export async function createPackCheckout(
  checkouts: PolarCheckouts,
  input: { workspaceId: string; pack: PackId; origin: string; products: Partial<Record<PackId, string>>; email?: string | null },
): Promise<string> {
  const productId = input.products[input.pack];
  if (!productId) throw new Error(`No Polar product for the ${PACKS[input.pack].name} pack yet (${polarProductEnvName(input.pack)}).`);
  const { url } = await checkouts.create({
    products: [productId],
    external_customer_id: input.workspaceId,
    ...(input.email ? { customer_email: input.email } : {}),
    success_url: `${input.origin}/credits?paid=1`,
    // Copied onto the order; the webhook reads it back.
    metadata: { workspace_id: input.workspaceId, pack: input.pack, credits: PACKS[input.pack].credits },
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

export type PolarEventResult = { type: string; handled: boolean; added: number; note: string };

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

type OrderLike = {
  id?: unknown;
  paid?: unknown;
  status?: unknown;
  product_id?: unknown;
  metadata?: Record<string, unknown> | null;
  customer?: { external_id?: unknown } | null;
  total_amount?: unknown;
  refunded_amount?: unknown;
  currency?: unknown;
};

/** Workspace and pack of an order: metadata from our checkout first, else the customer and product. */
async function resolveOrder(pool: pg.Pool, o: OrderLike, products: Partial<Record<PackId, string>>) {
  const meta = o.metadata ?? {};
  const pack: PackId | null = isPackId(meta.pack) ? meta.pack : packForProduct(products, o.product_id);
  const candidate = typeof meta.workspace_id === "string" ? meta.workspace_id : typeof o.customer?.external_id === "string" ? o.customer.external_id : null;
  let workspaceId: string | null = null;
  if (pack && candidate && UUID_RE.test(candidate)) {
    const { rows } = await pool.query("select id from public.workspaces where id = $1", [candidate]);
    workspaceId = rows[0]?.id ?? null;
  }
  return { pack, workspaceId };
}

const money = (cents: unknown, currency: unknown) =>
  typeof cents === "number" && typeof currency === "string" ? `${(cents / 100).toFixed(2)} ${currency.toUpperCase()}` : null;

/**
 * What to do with each verified event.
 * - order.paid: the pack's credits, once per order (ledger key `polar:<order id>`), so Polar's retries
 *   and repeated deliveries add nothing. Orders that aren't a FirstLine pack are acknowledged and ignored.
 * - order.refunded: logged for the workspace and shown on /admin. Credits are not taken back automatically.
 * Never throws for data we can't use: Polar disables an endpoint after 10 failed deliveries in a row.
 */
export async function handlePolarEvent(pool: pg.Pool, event: PolarEvent, products: Partial<Record<PackId, string>>): Promise<PolarEventResult> {
  const base = { type: event.type, handled: false, added: 0 };
  if (event.type === "order.paid") {
    const o = event.data as unknown as OrderLike;
    const orderId = typeof o.id === "string" ? o.id : null;
    if (!orderId) return { ...base, note: "no order id" };
    if (o.paid === false || (typeof o.status === "string" && o.status !== "paid")) return { ...base, note: `order not paid (${String(o.status)})` };
    const { pack, workspaceId } = await resolveOrder(pool, o, products);
    if (!pack) return { ...base, note: "not a FirstLine credit pack" };
    if (!workspaceId) {
      console.error(`polar order ${orderId}: pack ${pack} paid, but no known workspace on it`);
      return { ...base, note: "no known workspace on this order" };
    }
    const p = PACKS[pack];
    const paid = money(o.total_amount, o.currency);
    const added = await addPurchase(pool, {
      workspaceId,
      credits: p.credits,
      key: `polar:${orderId}`,
      kind: p.kind,
      note: `${p.name} pack (${p.id}): ${p.credits.toLocaleString("en")} ${p.kind === "lite" ? "Lite " : ""}credits · Polar${paid ? ` · ${paid} paid` : ""}`,
    });
    if (added) {
      await logActivity(pool, { workspaceId, userId: null, actor: "Payment (Polar)", action: "credits.bought", target: `${p.name} pack`, details: { credits: p.credits, kind: p.kind, order: orderId } });
    }
    return { ...base, handled: true, added: added ? p.credits : 0, note: added ? `${p.credits} credits added` : "already credited" };
  }
  if (event.type === "order.refunded") {
    const o = event.data as unknown as OrderLike;
    const { pack, workspaceId } = await resolveOrder(pool, o, products);
    if (!pack || !workspaceId) return { ...base, note: "refund for an order that isn't a FirstLine pack" };
    await logActivity(pool, {
      workspaceId,
      userId: null,
      actor: "Payment (Polar)",
      action: "payment.refunded",
      target: `${PACKS[pack].name} pack`,
      details: { order: o.id, pack, refunded: money(o.refunded_amount, o.currency), credits: PACKS[pack].credits },
    });
    return { ...base, handled: true, note: "refund logged; credits not taken back automatically" };
  }
  return { ...base, note: "ignored event type" };
}
