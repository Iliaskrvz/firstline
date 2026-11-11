import { describe, expect, it } from "vitest";
import { callJson, RateLimiter, redactUrl } from "./http";
import { ToolError, type FetchLike } from "./types";

const reply = (status: number, body: unknown, headers: Record<string, string> = {}): FetchLike => async () => ({
  status,
  headers: { get: (n) => headers[n.toLowerCase()] ?? null },
  text: async () => (typeof body === "string" ? body : JSON.stringify(body)),
});

describe("shared tool HTTP", () => {
  it("redacts keys in URLs", () => {
    expect(redactUrl("https://server.smartlead.ai/api/v1/campaigns/?api_key=sk_123&x=1")).toBe("https://server.smartlead.ai/api/v1/campaigns/?api_key=***&x=1");
  });

  it("never puts the URL or key in an error", async () => {
    const boom: FetchLike = async (url) => {
      throw new TypeError(`fetch failed for ${url}`);
    };
    const e = await callJson({ fetch: boom, tool: "Smartlead" }, "GET", "https://x/y?api_key=SECRET123").catch((x: Error) => x);
    expect(e).toBeInstanceOf(ToolError);
    expect(String((e as Error).message)).not.toContain("SECRET123");
    const e2 = await callJson({ fetch: reply(400, "bad"), tool: "Smartlead" }, "GET", "https://x/y?api_key=SECRET123").catch((x: Error) => x);
    expect(String((e2 as Error).message)).not.toContain("SECRET123");
  });

  it("maps statuses and reads Retry-After from header or body", async () => {
    const o = (f: FetchLike) => ({ fetch: f, tool: "T" });
    await expect(callJson(o(reply(401, {})), "GET", "u")).rejects.toMatchObject({ kind: "auth" });
    await expect(callJson(o(reply(429, {}, { "retry-after": "7" })), "GET", "u")).rejects.toMatchObject({ kind: "rate_limit", retryAfterMs: 7000 });
    await expect(callJson(o(reply(429, { error: { code: "RATE_LIMIT_EXCEEDED", retry_after: 30 } })), "GET", "u")).rejects.toMatchObject({ retryAfterMs: 30000 });
    await expect(callJson(o(reply(503, "")), "GET", "u")).rejects.toMatchObject({ kind: "transient" });
    await expect(callJson(o(reply(422, { message: "Invalid email format" })), "GET", "u")).rejects.toMatchObject({ kind: "invalid", message: "Invalid email format" });
    expect(await callJson(o(reply(200, [1, 2])), "GET", "u")).toEqual([1, 2]);
  });

  it("rate limiter waits once the window is full", async () => {
    let t = 0;
    const waits: number[] = [];
    const lim = new RateLimiter(2, 1000, () => t, async (ms) => {
      waits.push(ms);
      t += ms;
    });
    await lim.take("k");
    await lim.take("k");
    await lim.take("k");
    expect(waits).toHaveLength(1);
    await lim.take("other");
    expect(waits).toHaveLength(1);
  });
});
