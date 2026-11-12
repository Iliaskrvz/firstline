// Polar checkout and webhooks without a Polar account: a fake checkout client, and webhook bodies
// signed here the way Polar signs them (Standard Webhooks, HMAC-SHA256, base64).
import { createHmac } from "node:crypto";
import { webhooks } from "@polar-sh/sdk/2026-10";
import { describe, expect, it } from "vitest";
import { createPolarCheckout, fakePolarCheckouts, handlePolarEvent, parseProductIds, polarEnvironment, verifyPolarWebhook } from "./polar";

const PRODUCT = "3f0c2a52-6a1e-4d6b-9a55-0c8f6c1b2d11";
const SECRET = "test-only-not-a-real-secret";
const NO_DB = {} as unknown as import("pg").Pool;

// Shape of an order.paid delivery (API 2026-10), trimmed to the fields we read. Ids are made up.
const ORDER_PAID = {
  type: "order.paid",
  timestamp: "2026-11-12T20:00:00Z",
  api_version: "2026-10",
  data: {
    id: "b8f1c0de-1111-4a2b-9c3d-123456789abc",
    status: "paid",
    paid: true,
    total_amount: 1000,
    currency: "usd",
    billing_reason: "purchase",
    customer_id: "c0ffee00-2222-4a2b-9c3d-123456789abc",
    product_id: PRODUCT,
    checkout_id: "d00dfeed-3333-4a2b-9c3d-123456789abc",
    metadata: {},
    customer: { id: "c0ffee00-2222-4a2b-9c3d-123456789abc", external_id: "00000000-0000-0000-0000-0000000000aa", email: "buyer@example.com" },
  },
};

function sign(body: string, id = "msg_1", ts = Math.floor(Date.now() / 1000), secret = SECRET) {
  const sig = createHmac("sha256", secret).update(`${id}.${ts}.${body}`).digest("base64");
  return { "webhook-id": id, "webhook-timestamp": String(ts), "webhook-signature": `v1,${sig}` };
}

describe("Polar checkout", () => {
  it("reads product ids from ?products= and rejects anything else", () => {
    expect(parseProductIds([PRODUCT])).toEqual([PRODUCT]);
    expect(parseProductIds([`${PRODUCT}, ${PRODUCT}`])).toEqual([PRODUCT]);
    expect(parseProductIds([])).toBeNull();
    expect(parseProductIds(["not-a-uuid"])).toBeNull();
    expect(parseProductIds([Array.from({ length: 11 }, () => PRODUCT).join(",")])).toBeNull();
  });

  it("creates a checkout with the workspace as external customer, and returns Polar's url", async () => {
    const fake = fakePolarCheckouts("https://app.example");
    const url = await createPolarCheckout(fake, { products: [PRODUCT], workspaceId: "ws-1", email: "me@example.com", ip: "203.0.113.9" });
    expect(url).toBe("https://app.example/credits?fake_checkout=fake_1");
    expect(fake.calls).toEqual([{ products: [PRODUCT], external_customer_id: "ws-1", customer_email: "me@example.com", customer_ip_address: "203.0.113.9" }]);
    await createPolarCheckout(fake, { products: [PRODUCT] });
    expect(fake.calls[1]).toEqual({ products: [PRODUCT] }); // guests: no customer fields, no success URL
  });

  it("uses production unless POLAR_SERVER=sandbox", () => {
    expect(polarEnvironment({})).toBe("production");
    expect(polarEnvironment({ POLAR_SERVER: "sandbox" })).toBe("sandbox");
    expect(polarEnvironment({ POLAR_SERVER: "production" })).toBe("production");
  });
});

describe("Polar webhooks", () => {
  const body = JSON.stringify(ORDER_PAID);

  it("accepts a correctly signed delivery", async () => {
    const event = await verifyPolarWebhook(body, sign(body), SECRET);
    expect(event.type).toBe("order.paid");
    // No pack product configured: acknowledged without touching the database.
    expect(await handlePolarEvent(NO_DB, event, {})).toEqual({ type: "order.paid", handled: false, added: 0, note: "not a FirstLine credit pack" });
  });

  it("rejects a wrong secret, a changed body and an old timestamp", async () => {
    await expect(verifyPolarWebhook(body, sign(body, "msg_1", undefined, "other"), SECRET)).rejects.toBeInstanceOf(webhooks.PolarWebhookVerificationError);
    await expect(verifyPolarWebhook(body.replace("1000", "1"), sign(body), SECRET)).rejects.toBeInstanceOf(webhooks.PolarWebhookVerificationError);
    const old = Math.floor(Date.now() / 1000) - 600;
    await expect(verifyPolarWebhook(body, sign(body, "msg_1", old), SECRET)).rejects.toBeInstanceOf(webhooks.PolarWebhookVerificationError);
  });

  it("acknowledges customer.state_changed and flags unknown event types", async () => {
    const state = JSON.stringify({ type: "customer.state_changed", timestamp: "2026-11-12T20:00:00Z", api_version: "2026-10", data: { id: "c1", external_id: null, active_subscriptions: [], granted_benefits: [], active_meters: [] } });
    const event = await verifyPolarWebhook(state, sign(state), SECRET);
    expect((await handlePolarEvent(NO_DB, event, {})).note).toBe("ignored event type");
    const odd = JSON.stringify({ type: "something.new", data: {} });
    await expect(verifyPolarWebhook(odd, sign(odd), SECRET)).rejects.toBeInstanceOf(webhooks.PolarWebhookUnknownTypeError);
  });
});
