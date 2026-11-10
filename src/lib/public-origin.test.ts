import { describe, expect, it } from "vitest";
import { publicOrigin, publicUrl } from "./public-origin";

const h = (o: Record<string, string>) => ({ get: (k: string) => o[k.toLowerCase()] ?? null });

describe("publicOrigin", () => {
  it("uses Caddy's forwarded host and protocol on the VPS", () => {
    expect(publicOrigin(h({ host: "127.0.0.1:3100", "x-forwarded-host": "firstline.46-17-99-33.sslip.io", "x-forwarded-proto": "https" }), "http://localhost:3100")).toBe(
      "https://firstline.46-17-99-33.sslip.io",
    );
  });
  it("works locally without a proxy", () => {
    expect(publicOrigin(h({ host: "localhost:3000" }), "http://localhost:3000")).toBe("http://localhost:3000");
  });
  it("ignores malformed headers", () => {
    expect(publicOrigin(h({ host: "evil.com/path?x", "x-forwarded-proto": "javascript" }), "http://localhost:3000")).toBe("http://localhost:3000");
    expect(publicOrigin(h({ "x-forwarded-host": "a b", host: "ok.nl" }), "https://x.nl")).toBe("https://ok.nl");
  });
  it("builds redirect URLs on that origin", () => {
    expect(publicUrl(h({ "x-forwarded-host": "app.nl", "x-forwarded-proto": "https" }), "http://localhost:3100", "/login?next=%2Fcampaigns").href).toBe(
      "https://app.nl/login?next=%2Fcampaigns",
    );
  });
});
