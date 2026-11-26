// SSRF protection for the public demo and our robots.txt fetch. No real DNS: resolvers are scripted.
import { describe, expect, it } from "vitest";
import { createFirecrawl } from "@/engine/firecrawl";
import { isPrivateIp, isPublicHost, isPublicUrlHost, parsePublicDomain } from "./public-host";
import { verifyTurnstile } from "./turnstile";

describe("parsePublicDomain", () => {
  it("turns what people type into a plain domain", () => {
    expect(parsePublicDomain("acme.nl")).toBe("acme.nl");
    expect(parsePublicDomain("  https://www.Acme.nl/over-ons?x=1 ")).toBe("acme.nl");
    expect(parsePublicDomain("http://shop.acme.co.uk")).toBe("shop.acme.co.uk");
  });
  it("refuses IPs, internal names, odd ports, credentials and other schemes", () => {
    for (const bad of [
      "",
      "localhost",
      "http://localhost:3000",
      "127.0.0.1",
      "http://169.254.169.254/latest/meta-data",
      "http://[::1]/",
      "http://0x7f000001",
      "intranet",
      "printer.local",
      "db.internal",
      "acme.nl:8080",
      "https://user:pw@acme.nl",
      "ftp://acme.nl",
      "javascript:alert(1)",
      "file:///etc/passwd",
      "1.2.3.4.5",
    ]) {
      expect(parsePublicDomain(bad), bad).toBeNull();
    }
  });
});

describe("isPrivateIp / isPublicHost", () => {
  it("knows private and reserved ranges", () => {
    for (const ip of ["10.0.0.1", "127.0.0.1", "169.254.169.254", "172.16.5.4", "172.31.255.255", "192.168.1.1", "100.64.0.1", "0.0.0.0", "224.0.0.1", "::1", "fd00::1", "fe80::1", "::ffff:10.0.0.1"]) {
      expect(isPrivateIp(ip), ip).toBe(true);
    }
    for (const ip of ["93.184.216.34", "172.32.0.1", "8.8.8.8", "2606:4700::1111"]) expect(isPrivateIp(ip), ip).toBe(false);
  });
  it("a host is public only if every address it resolves to is public", async () => {
    expect(await isPublicHost("acme.nl", async () => ["93.184.216.34"])).toBe(true);
    expect(await isPublicHost("rebind.example.com", async () => ["93.184.216.34", "127.0.0.1"])).toBe(false);
    expect(await isPublicHost("acme.nl", async () => [])).toBe(false);
    expect(await isPublicHost("acme.nl", async () => Promise.reject(new Error("ENOTFOUND")))).toBe(false);
  });
});

describe("isPublicUrlHost (outgoing webhooks)", () => {
  const dns = (table: Record<string, string[]>) => async (h: string) => {
    if (!(h in table)) throw new Error("ENOTFOUND");
    return table[h];
  };
  const r = dns({ "hooks.example.com": ["93.184.216.34"], "sneaky.example.com": ["169.254.169.254"], "mixed.example.com": ["93.184.216.34", "10.0.0.5"], "v6.example.com": ["::1"] });

  it("allows public hosts on any port, refuses names that resolve inside our network", async () => {
    expect(await isPublicUrlHost("https://hooks.example.com/x", r)).toBe(true);
    expect(await isPublicUrlHost("https://hooks.example.com:5678/webhook/abc", r)).toBe(true);
    expect(await isPublicUrlHost("https://sneaky.example.com/x", r)).toBe(false); // cloud metadata
    expect(await isPublicUrlHost("https://mixed.example.com/x", r)).toBe(false);
    expect(await isPublicUrlHost("https://v6.example.com/x", r)).toBe(false);
    expect(await isPublicUrlHost("https://nowhere.example.com/x", r)).toBe(false);
  });

  it("checks IP literals directly, v4 and v6, and refuses internal names", async () => {
    expect(await isPublicUrlHost("https://93.184.216.34/x", r)).toBe(true);
    expect(isPrivateIp("::ffff:a00:1")).toBe(true); // 10.0.0.1 in hex
    expect(isPrivateIp("::ffff:5db8:d822")).toBe(false); // 93.184.216.34
    for (const u of ["https://127.0.0.1/x", "http://169.254.169.254/latest", "https://[::1]/x", "https://[::ffff:10.0.0.1]/x", "https://localhost:3100/", "https://worker.internal/", "https://2130706433/", "not a url"]) {
      expect(await isPublicUrlHost(u, r), u).toBe(false);
    }
  });
});

describe("robots.txt fetch follows redirects only to public hosts", () => {
  const scripted = (map: Record<string, { status: number; location?: string; body?: string }>) => {
    const seen: string[] = [];
    const f = (async (url: string) => {
      seen.push(url);
      const r = map[url] ?? { status: 404 };
      return new Response(r.body ?? "", { status: r.status, headers: r.location ? { location: r.location } : {} });
    }) as unknown as typeof fetch;
    return { f, seen };
  };
  const allowed = async (host: string) => host !== "internal.acme.nl";

  it("follows a redirect to a public host", async () => {
    const { f } = scripted({
      "https://acme.nl/robots.txt": { status: 301, location: "https://www.acme.nl/robots.txt" },
      "https://www.acme.nl/robots.txt": { status: 200, body: "User-agent: *\nDisallow: /admin" },
    });
    expect(await createFirecrawl("test", f, {}, allowed).robots("acme.nl")).toContain("Disallow: /admin");
  });

  it("stops at a redirect to a private host, and never fetches it", async () => {
    const { f, seen } = scripted({ "https://acme.nl/robots.txt": { status: 302, location: "http://internal.acme.nl/robots.txt" } });
    expect(await createFirecrawl("test", f, {}, allowed).robots("acme.nl")).toBeNull();
    expect(seen).toEqual(["https://acme.nl/robots.txt"]);
  });

  it("doesn't fetch at all when the domain itself isn't public", async () => {
    const { f, seen } = scripted({});
    expect(await createFirecrawl("test", f, {}, async () => false).robots("acme.nl")).toBeNull();
    expect(seen).toEqual([]);
  });
});

describe("Turnstile", () => {
  it("passes only on success from Cloudflare", async () => {
    const reply = (body: unknown, ok = true) => async () => ({ ok, json: async () => body });
    expect(await verifyTurnstile("tok", "203.0.113.9", "secret", reply({ success: true }))).toBe(true);
    expect(await verifyTurnstile("tok", null, "secret", reply({ success: false, "error-codes": ["invalid-input-response"] }))).toBe(false);
    expect(await verifyTurnstile("", null, "secret", reply({ success: true }))).toBe(false);
    expect(await verifyTurnstile("tok", null, "secret", reply({}, false))).toBe(false);
  });
});
