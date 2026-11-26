// Can a domain receive email? DNS only (MX, then A/AAAA). Never SMTP: we don't connect to mail servers.
//   MX records         → "mx"      (fine)
//   null MX (RFC 7505) → "null_mx" (the domain says it accepts no mail: invalid)
//   no MX, but A/AAAA  → "a_only"  (some still receive mail: risky)
//   domain doesn't exist / no records at all → "none" (invalid)
//   timeout or server failure → "unknown" (risky; checked again later)
import { Resolver } from "node:dns/promises";
import type { DomainResult } from "./email-check";

export interface MxResolver {
  resolveMx(domain: string): Promise<{ exchange: string; priority: number }[]>;
  resolve4(domain: string): Promise<string[]>;
  resolve6(domain: string): Promise<string[]>;
}

/** The system's DNS servers, with a short timeout. */
export function systemResolver(timeoutMs = 3000): MxResolver {
  const r = new Resolver({ timeout: timeoutMs, tries: 2 });
  return { resolveMx: (d) => r.resolveMx(d), resolve4: (d) => r.resolve4(d), resolve6: (d) => r.resolve6(d) };
}

const NOT_FOUND = new Set(["ENOTFOUND", "ENODATA", "NXDOMAIN", "ENONAME"]);
const code = (e: unknown) => (e as { code?: string })?.code ?? "";

function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(Object.assign(new Error("DNS timeout"), { code: "ETIMEOUT" })), ms);
    p.then(
      (v) => (clearTimeout(t), resolve(v)),
      (e) => (clearTimeout(t), reject(e)),
    );
  });
}

export async function classifyDomain(domain: string, resolver: MxResolver, timeoutMs = 4000): Promise<DomainResult> {
  try {
    const mx = await withTimeout(resolver.resolveMx(domain), timeoutMs);
    if (mx.length === 0) throw Object.assign(new Error("no MX"), { code: "ENODATA" });
    // RFC 7505: a single MX of "." with preference 0 means "this domain accepts no mail".
    if (mx.every((m) => m.exchange === "" || m.exchange === ".")) return "null_mx";
    return "mx";
  } catch (e) {
    if (!NOT_FOUND.has(code(e))) return "unknown";
    if (code(e) === "ENOTFOUND" || code(e) === "NXDOMAIN") return "none";
  }
  // The domain exists but has no MX: does it have an address at all?
  for (const look of [resolver.resolve4, resolver.resolve6]) {
    try {
      if ((await withTimeout(look.call(resolver, domain), timeoutMs)).length) return "a_only";
    } catch (e) {
      if (!NOT_FOUND.has(code(e))) return "unknown";
    }
  }
  return "none";
}

/** A resolver for tests: answers from a table, `throw:<code>` simulates DNS errors, `hang` never answers. */
export function fakeResolver(table: Record<string, { mx?: string[] | string; a?: string[] }>): MxResolver & { calls: string[] } {
  const calls: string[] = [];
  const entry = (d: string) => table[d];
  const answer = <T>(d: string, kind: "mx" | "a", map: (v: string[]) => T): Promise<T> => {
    calls.push(`${kind}:${d}`);
    const e = entry(d);
    if (!e) return Promise.reject(Object.assign(new Error("not found"), { code: "ENOTFOUND" }));
    const v = e[kind];
    if (v === "hang") return new Promise(() => {});
    if (typeof v === "string" && v.startsWith("throw:")) return Promise.reject(Object.assign(new Error(v), { code: v.slice(6) }));
    if (!v || (Array.isArray(v) && v.length === 0)) return Promise.reject(Object.assign(new Error("no data"), { code: "ENODATA" }));
    return Promise.resolve(map(Array.isArray(v) ? v : [v]));
  };
  return {
    calls,
    resolveMx: (d) => answer(d, "mx", (v) => v.map((exchange, i) => ({ exchange, priority: i * 10 }))),
    resolve4: (d) => answer(d, "a", (v) => v),
    resolve6: (d) => (calls.push(`aaaa:${d}`), Promise.reject(Object.assign(new Error("no data"), { code: "ENODATA" }))),
  };
}
