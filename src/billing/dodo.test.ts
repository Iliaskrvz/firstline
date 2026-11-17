// Dodo Payments without an account: checkout bodies, product ids, test/live mode, and signed webhooks.
// Payloads follow the dodopayments SDK types (PaymentSucceededWebhookEvent, RefundSucceededWebhookEvent).
import { createHmac } from "node:crypto";
import { describe, expect, it } from "vitest";
import { createLinkCheckout, createPackCheckout, dodoEnvironment, dodoProductIds, fakeDodoCheckouts, parseProductIds, verifyDodoWebhook, WebhookVerificationError } from "./dodo";

// Standard Webhooks secrets are "whsec_" + base64; this one is made up for the tests.
const SECRET = `whsec_${Buffer.from("test-only-not-a-real-secret-123").toString("base64")}`;
const KEY = Buffer.from(SECRET.slice(6), "base64");
const sign = (body: string, id = "msg_1", ts = Math.floor(Date.now() / 1000), key = KEY) => ({
  "webhook-id": id,
  "webhook-timestamp": String(ts),
  "webhook-signature": `v1,${createHmac("sha256", key).update(`${id}.${ts}.${body}`).digest("base64")}`,
});

export const RECORDED_PAYMENT_SUCCEEDED = {
  business_id: "bus_test_1",
  type: "payment.succeeded",
  timestamp: "2026-11-17T12:00:00Z",
  data: {
    payload_type: "Payment",
    payment_id: "pay_test_1",
    business_id: "bus_test_1",
    status: "succeeded",
    total_amount: 2299,
    currency: "EUR",
    customer: { customer_id: "cus_test_1", email: "owner@example.nl", name: "Owner" },
    metadata: { workspace_id: "00000000-0000-4000-8000-000000000000", pack: "starter", credits: "500" },
    product_cart: [{ product_id: "pdt_starter", quantity: 1 }],
    created_at: "2026-11-17T11:59:58Z",
  },
};

describe("Dodo checkout", () => {
  const products = { starter: "pdt_starter", growth: "pdt_growth", agency: "pdt_agency" };

  it("pack checkout: one product, the customer's email, our ids in metadata, back to /credits", async () => {
    const fake = fakeDodoCheckouts("https://app.test");
    const url = await createPackCheckout(fake, { workspaceId: "ws-1", pack: "growth", origin: "https://app.test", products, email: "me@x.nl" });
    expect(url).toBe("https://app.test/credits?fake_checkout=cks_fake_1");
    expect(fake.calls[0]).toEqual({
      product_cart: [{ product_id: "pdt_growth", quantity: 1 }],
      customer: { email: "me@x.nl" },
      return_url: "https://app.test/credits?paid=1",
      metadata: { workspace_id: "ws-1", pack: "growth", credits: 2000 },
    });
    await expect(createPackCheckout(fake, { workspaceId: "ws-1", pack: "lite-50k", origin: "https://app.test", products })).rejects.toThrow(/DODO_PRODUCT_LITE_50K/);
  });

  it("link checkout and the ?products= parameter", async () => {
    expect(parseProductIds(["pdt_a,pdt_b", "pdt_a"])).toEqual(["pdt_a", "pdt_b"]);
    expect(parseProductIds([""])).toBeNull();
    expect(parseProductIds(["pdt_a;drop"])).toBeNull();
    const fake = fakeDodoCheckouts("https://app.test");
    await createLinkCheckout(fake, { products: ["pdt_a"], workspaceId: "ws-1", origin: "https://app.test" });
    expect(fake.calls[0]).toMatchObject({ product_cart: [{ product_id: "pdt_a", quantity: 1 }], metadata: { workspace_id: "ws-1" } });
    expect(fake.calls[0].customer).toBeUndefined();
  });

  it("a missing checkout link is an error, not a redirect to nowhere", async () => {
    await expect(createPackCheckout({ create: async () => ({ session_id: "cks_1", checkout_url: null }) }, { workspaceId: "w", pack: "starter", origin: "https://a", products })).rejects.toThrow(/checkout link/);
  });

  it("test or live mode follows the key; product ids come from DODO_PRODUCT_<PACK>", () => {
    expect(dodoEnvironment("dodo_test_abc.def")).toBe("test_mode");
    expect(dodoEnvironment(" dodo_live_abc.def")).toBe("live_mode");
    expect(dodoEnvironment(undefined)).toBe("test_mode");
    expect(dodoProductIds({ DODO_PRODUCT_STARTER: " pdt_s ", DODO_PRODUCT_LITE_50K: "pdt_l", DODO_PRODUCT_GROWTH: "" })).toEqual({ starter: "pdt_s", "lite-50k": "pdt_l" });
  });
});

describe("Dodo webhooks", () => {
  const body = JSON.stringify(RECORDED_PAYMENT_SUCCEEDED);

  it("accepts a correctly signed delivery", () => {
    expect(verifyDodoWebhook(body, sign(body), SECRET)).toMatchObject({ type: "payment.succeeded", data: { payment_id: "pay_test_1" } });
  });

  it("rejects a wrong secret, a changed body and an old timestamp", () => {
    expect(() => verifyDodoWebhook(body, sign(body, "msg_1", undefined, Buffer.from("other")), SECRET)).toThrow(WebhookVerificationError);
    expect(() => verifyDodoWebhook(body.replace("2299", "1"), sign(body), SECRET)).toThrow(WebhookVerificationError);
    expect(() => verifyDodoWebhook(body, sign(body, "msg_1", Math.floor(Date.now() / 1000) - 3600), SECRET)).toThrow(WebhookVerificationError);
  });

  it("rejects a signed body that isn't an event", () => {
    const junk = JSON.stringify({ hello: "world" });
    expect(() => verifyDodoWebhook(junk, sign(junk), SECRET)).toThrow(WebhookVerificationError);
  });
});
