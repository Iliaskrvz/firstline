// The webhook route itself: status codes Polar acts on (403 bad signature, 202 handled/unknown).
import { createHmac } from "node:crypto";
import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
// Orders for products that aren't a pack never reach the database.
vi.mock("@/server/db", () => ({ serverPool: () => ({ query: vi.fn(async () => { throw new Error("no database in this test"); }) }) }));
const { POST } = await import("./route");

const SECRET = "test-only-not-a-real-secret";
const post = (body: string, secret = SECRET, ts = Math.floor(Date.now() / 1000)) =>
  POST(
    new NextRequest("http://localhost/api/webhook/polar", {
      method: "POST",
      body,
      headers: { "webhook-id": "msg_1", "webhook-timestamp": String(ts), "webhook-signature": `v1,${createHmac("sha256", secret).update(`msg_1.${ts}.${body}`).digest("base64")}` },
    }),
  );

describe("POST /api/webhook/polar", () => {
  beforeEach(() => {
    process.env.POLAR_WEBHOOK_SECRET = SECRET;
  });
  afterEach(() => {
    delete process.env.POLAR_WEBHOOK_SECRET;
  });

  it("202 for a signed order.paid, 403 for a bad signature, 202 for an unknown type", async () => {
    const paid = JSON.stringify({ type: "order.paid", timestamp: "2026-11-12T20:00:00Z", api_version: "2026-10", data: { id: "o1", metadata: {} } });
    const ok = await post(paid);
    expect(ok.status).toBe(202);
    expect(await ok.json()).toMatchObject({ received: true, type: "order.paid", handled: false });
    expect((await post(paid, "wrong")).status).toBe(403);
    expect((await post(JSON.stringify({ type: "brand.new", data: {} }))).status).toBe(202);
  });

  it("503 when the secret isn't configured", async () => {
    delete process.env.POLAR_WEBHOOK_SECRET;
    expect((await post("{}")).status).toBe(503);
  });
});
