// Free email checks: the rules, DNS with a fake resolver, and the guards that our servers never
// connect to a mail server (port 25) to "ping" a mailbox.
import { readdirSync, readFileSync } from "node:fs";
import net from "node:net";
import path from "node:path";
import tls from "node:tls";
import { afterEach, describe, expect, it, vi } from "vitest";
import { combine, isDisposableDomain, isRoleAddress, normaliseEmail, staticCheck, suggestDomain, summarise } from "./email-check";
import { classifyDomain, fakeResolver } from "./email-dns";

describe("format", () => {
  it("practical syntax: trims, drops mailto: and brackets, lowercases", () => {
    expect(normaliseEmail("  <Mailto:Sanne@BakkerijVos.NL> ")).toBe("sanne@bakkerijvos.nl");
    for (const ok of ["a@b.co", "first.last+tag@sub.example.co.uk", "o'brien@firm.ie"]) expect(staticCheck(ok).invalid, ok).toEqual([]);
    for (const bad of ["", "plainaddress", "a@b", "a@@b.com", "a b@c.com", "a@-b.com", "a@b.c", "a@b..com", `${"x".repeat(65)}@b.com`]) {
      expect(staticCheck(bad).invalid, bad).toEqual(["syntax"]);
    }
  });
});

describe("throwaway, role, personal and typo", () => {
  it("throwaway domains from the vendored CC0 list, subdomains included", () => {
    expect(isDisposableDomain("mailinator.com")).toBe(true);
    expect(isDisposableDomain("inbox.mailinator.com")).toBe(true);
    expect(isDisposableDomain("gmail.com")).toBe(false);
    expect(staticCheck("x@mailinator.com").invalid).toEqual(["disposable"]);
  });

  it("role addresses in English, Dutch and German, ignoring +tags", () => {
    for (const r of ["info@acme.nl", "sales+eu@acme.com", "verkoop@acme.nl", "kantoor@acme.nl", "vertrieb@acme.de", "kontakt@acme.de", "no-reply@acme.com"]) expect(isRoleAddress(r), r).toBe(true);
    for (const p of ["sanne@acme.nl", "information.desk@acme.nl", "infoman@acme.nl"]) expect(isRoleAddress(p), p).toBe(false);
  });

  it("personal addresses at free-mail providers are risky, not invalid", () => {
    expect(staticCheck("sanne@gmail.com")).toMatchObject({ invalid: [], risky: ["personal"] });
    expect(staticCheck("info@hotmail.com").risky).toEqual(["role", "personal"]);
  });

  it("typo domains get a suggestion; the address itself is never changed", () => {
    expect(suggestDomain("gmial.com")).toBe("gmail.com");
    expect(suggestDomain("hotmial.com")).toBe("hotmail.com");
    expect(suggestDomain("outlok.com")).toBe("outlook.com");
    expect(suggestDomain("acme.con")).toBe("acme.com");
    expect(suggestDomain("gmaul.com")).toBe("gmail.com"); // one letter off a common provider
    expect(suggestDomain("gmail.com")).toBeNull();
    expect(suggestDomain("bakkerijvos.nl")).toBeNull();
    expect(staticCheck("sanne@gmial.com")).toMatchObject({ email: "sanne@gmial.com", risky: ["typo"], suggestion: "sanne@gmail.com" });
  });
});

describe("domain DNS (fake resolver)", () => {
  const r = fakeResolver({
    "acme.nl": { mx: ["mx1.acme.nl", "mx2.acme.nl"] },
    "nomail.example": { mx: "." },
    "webonly.nl": { a: ["192.0.2.1"] },
    "empty.nl": {},
    "slow.nl": { mx: "hang" },
    "broken.nl": { mx: "throw:ESERVFAIL" },
  });

  it("MX → mx; null MX → null_mx; A only → a_only; nothing → none; errors → unknown", async () => {
    expect(await classifyDomain("acme.nl", r)).toBe("mx");
    expect(await classifyDomain("nomail.example", r)).toBe("null_mx");
    expect(await classifyDomain("webonly.nl", r)).toBe("a_only");
    expect(await classifyDomain("empty.nl", r)).toBe("none");
    expect(await classifyDomain("doesnotexist.nl", r)).toBe("none");
    expect(await classifyDomain("broken.nl", r)).toBe("unknown");
    expect(await classifyDomain("slow.nl", r, 30)).toBe("unknown"); // timeout
  });

  it("verdicts: invalid wins, a pending DNS check stays pending, risky reasons are listed", () => {
    expect(combine(staticCheck("a@acme.nl"), "mx")).toEqual({ status: "valid", reason: null, reasons: [], suggestion: null });
    expect(combine(staticCheck("info@acme.nl"), "mx")).toMatchObject({ status: "risky", reason: "role" });
    expect(combine(staticCheck("a@webonly.nl"), "a_only")).toMatchObject({ status: "risky", reason: "a_only" });
    expect(combine(staticCheck("a@nomail.example"), "null_mx")).toMatchObject({ status: "invalid", reason: "null_mx" });
    expect(combine(staticCheck("info@gone.nl"), "none")).toMatchObject({ status: "invalid", reason: "no_dns", reasons: ["no_dns", "role"] });
    expect(combine(staticCheck("a@acme.nl"), null)).toMatchObject({ status: "pending" });
    expect(combine(staticCheck("x@mailinator.com"), null)).toMatchObject({ status: "invalid", reason: "disposable" });
    expect(combine(staticCheck("a@acme.nl"), "unknown")).toMatchObject({ status: "risky", reason: "dns_unknown" });
  });

  it("counts per status and reason", () => {
    const s = summarise([
      combine(staticCheck("a@acme.nl"), "mx"),
      combine(staticCheck("info@acme.nl"), "mx"),
      combine(staticCheck("info@gmail.com"), "mx"),
      combine(staticCheck("x@gone.nl"), "none"),
    ]);
    expect(s.byStatus).toEqual({ pending: 0, valid: 1, risky: 2, invalid: 1 });
    expect(s.byReason).toEqual({ role: 2, personal: 1, no_dns: 1 });
  });
});

describe("never SMTP (hard rule: no connections to mail servers from our servers)", () => {
  afterEach(() => vi.restoreAllMocks());

  it("checking addresses opens no socket at all, so certainly nothing on port 25", async () => {
    const opened: unknown[] = [];
    vi.spyOn(net.Socket.prototype, "connect").mockImplementation(function (this: net.Socket, ...args: unknown[]) {
      opened.push(args);
      throw new Error("socket connect attempted");
    });
    vi.spyOn(net, "connect").mockImplementation((...args: unknown[]) => {
      opened.push(args);
      throw new Error("net.connect attempted");
    });
    vi.spyOn(net, "createConnection").mockImplementation((...args: unknown[]) => {
      opened.push(args);
      throw new Error("net.createConnection attempted");
    });
    vi.spyOn(tls, "connect").mockImplementation((...args: unknown[]) => {
      opened.push(args);
      throw new Error("tls.connect attempted");
    });
    const r = fakeResolver({ "acme.nl": { mx: ["mx.acme.nl"] }, "webonly.nl": { a: ["192.0.2.1"] } });
    for (const e of ["a@acme.nl", "info@webonly.nl", "x@gone.nl", "x@mailinator.com", "bad"]) {
      const s = staticCheck(e);
      combine(s, s.domain ? await classifyDomain(s.domain, r) : null);
    }
    expect(opened).toEqual([]);
  });

  it("the checking code imports no networking or mail-sending module and names no SMTP port", () => {
    const dir = path.resolve(__dirname);
    const files = readdirSync(dir).filter((f) => /^email-(check|dns)(-pg)?\.ts$/.test(f));
    expect(files.length).toBeGreaterThanOrEqual(2);
    for (const f of files) {
      const src = readFileSync(path.join(dir, f), "utf8").replace(/^\s*\/\/.*$/gm, "");
      expect(src, f).not.toMatch(/from\s+["'](node:)?(net|tls|dgram|http|https)["']/);
      expect(src, f).not.toMatch(/from\s+["'](nodemailer|mailcheck|email-verifier|deep-email-validator|email-existence|smtp[\w-]*)["']/i);
      expect(src, f).not.toMatch(/\bsmtp\b/i);
      expect(src, f).not.toMatch(/\bport\s*[:=]\s*(25|465|587)\b|:25\b/);
    }
  });
});
