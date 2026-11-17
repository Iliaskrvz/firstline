// The webhook route itself: status codes Dodo acts on (403 bad signature, 202 handled/unknown, 503 unset).
import { createHmac } from "node:crypto";
import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
// Payments for products that aren't a pack never reach the database.
vi.mock("@/server/db", () => ({ serverPool: () => ({ query: vi.fn(async () => { throw new Error("no database in this test"); }) }) }));
const { POST } = await import("./route");

const SECRET = `whsec_${Buffer.from("test-only-not-a-real-secret-123").toString("base64")}`;
const KEY = Buffer.from(SECRET.slice(6), "base64");
const post = (body: string, key: Buffer = KEY, ts = Math.floor(Date.now() / 1000)) =>
  POST(
    new NextRequest("http://localhost/api/webhook/dodo", {
      method: "POST",
      body,
      headers: { "webhook-id": "msg_1", "webhook-timestamp": String(ts), "webhook-signature": `v1,${createHmac("sha256", key).update(`msg_1.${ts}.${body}`).digest("base64")}` },
    }),
  );

describe("POST /api/webhook/dodo", () => {
  beforeEach(() => {
    process.env.DODO_WEBHOOK_SECRET = SECRET;
  });
  afterEach(() => {
    delete process.env.DODO_WEBHOOK_SECRET;
  });

  it("202 for a signed payment that isn't a pack, 403 for a bad signature, 202 for an unknown type", async () => {
    const paid = JSON.stringify({ business_id: "bus_1", type: "payment.succeeded", timestamp: "2026-11-17T12:00:00Z", data: { payment_id: "pay_1", status: "succeeded", metadata: {}, product_cart: [{ product_id: "pdt_other", quantity: 1 }] } });
    const ok = await post(paid);
    expect(ok.status).toBe(202);
    expect(await ok.json()).toMatchObject({ received: true, type: "payment.succeeded", handled: false, note: "not a FirstLine credit pack" });
    expect((await post(paid, Buffer.from("wrong"))).status).toBe(403);
    expect((await post(JSON.stringify({ type: "subscription.active", data: {} }))).status).toBe(202);
  });

  it("503 when the secret isn't configured", async () => {
    delete process.env.DODO_WEBHOOK_SECRET;
    expect((await post("{}")).status).toBe(503);
  });
});
