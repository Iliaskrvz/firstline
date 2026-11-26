// SSRF protection: only public internet hosts may be researched or fetched by our server.
// Used by the public demo (anyone can type a URL) and by our own robots.txt fetch (which follows redirects).
import { lookup as dnsLookup } from "node:dns/promises";
import { isIP } from "node:net";

const BLOCKED_SUFFIXES = [".local", ".localhost", ".internal", ".intranet", ".lan", ".home", ".corp", ".private", ".test", ".example", ".invalid", ".onion", ".arpa"];

/** "https://www.Acme.nl/over-ons" → "acme.nl"; null when it isn't a plain public domain name. */
export function parsePublicDomain(input: string): string | null {
  const raw = input.trim();
  if (!raw || raw.length > 300) return null;
  let url: URL;
  try {
    url = new URL(/^[a-z][a-z0-9+.-]*:\/\//i.test(raw) ? raw : `https://${raw}`);
  } catch {
    return null;
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") return null;
  if (url.username || url.password) return null;
  if (url.port && url.port !== "80" && url.port !== "443") return null;
  let host = url.hostname.toLowerCase().replace(/\.$/, "");
  if (host.startsWith("[") || isIP(host)) return null; // IP literals, v4 and v6
  if (!/^[a-z0-9.-]+$/.test(host) || !host.includes(".") || host.length > 253) return null;
  if (host === "localhost" || BLOCKED_SUFFIXES.some((s) => host.endsWith(s))) return null;
  if (host.split(".").some((l) => !l || l.length > 63 || l.startsWith("-") || l.endsWith("-"))) return null;
  if (/^\d+$/.test(host.split(".").pop()!)) return null; // numeric TLD = an IP in disguise
  host = host.replace(/^www\./, "");
  return host;
}

const v4 = (ip: string) => ip.split(".").map(Number);

/** Private, loopback, link-local, CGNAT, multicast, reserved and documentation ranges (v4 and v6). */
export function isPrivateIp(ip: string): boolean {
  const kind = isIP(ip);
  if (kind === 4) {
    const [a, b, c] = v4(ip);
    return (
      a === 0 ||
      a === 10 ||
      a === 127 ||
      (a === 100 && b >= 64 && b <= 127) ||
      (a === 169 && b === 254) ||
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 0 && (c === 0 || c === 2)) ||
      (a === 192 && b === 168) ||
      (a === 198 && (b === 18 || b === 19)) ||
      (a === 198 && b === 51 && c === 100) ||
      (a === 203 && b === 0 && c === 113) ||
      a >= 224
    );
  }
  if (kind === 6) {
    const s = ip.toLowerCase();
    const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/.exec(s);
    if (mapped) return isPrivateIp(mapped[1]);
    // The same, written in hex (how URL parsing normalises it): ::ffff:a00:1 = 10.0.0.1.
    const hex = /^::ffff:([0-9a-f]{1,4}):([0-9a-f]{1,4})$/.exec(s);
    if (hex) {
      const hi = parseInt(hex[1], 16);
      const lo = parseInt(hex[2], 16);
      return isPrivateIp(`${hi >> 8}.${hi & 255}.${lo >> 8}.${lo & 255}`);
    }
    return s === "::" || s === "::1" || /^f[cd]/.test(s) || /^fe[89ab]/.test(s) || s.startsWith("ff") || s.startsWith("2001:db8") || s.startsWith("64:ff9b");
  }
  return true; // not an IP at all: refuse
}

export type Resolver = (host: string) => Promise<string[]>;
export const dnsResolver: Resolver = async (host) => (await dnsLookup(host, { all: true, verbatim: true })).map((a) => a.address);

/** True only when the host resolves, and every address it resolves to is public. */
export async function isPublicHost(host: string, resolve: Resolver = dnsResolver): Promise<boolean> {
  if (!parsePublicDomain(host)) return false;
  try {
    const ips = await resolve(host);
    return ips.length > 0 && ips.every((ip) => !isPrivateIp(ip));
  } catch {
    return false;
  }
}

/**
 * For URLs our server calls on a customer's behalf (outgoing webhooks): any port is fine, but the host
 * must be public. IP literals are checked directly; names must resolve, and only to public addresses.
 * Checked again right before every call, so a name that later points inside our network is refused.
 */
export async function isPublicUrlHost(url: string, resolve: Resolver = dnsResolver): Promise<boolean> {
  let host: string;
  try {
    host = new URL(url).hostname.toLowerCase().replace(/^\[|\]$/g, "").replace(/\.$/, "");
  } catch {
    return false;
  }
  if (!host) return false;
  if (isIP(host)) return !isPrivateIp(host);
  if (host === "localhost" || !host.includes(".") || BLOCKED_SUFFIXES.some((s) => host.endsWith(s))) return false;
  if (/^\d+$/.test(host.split(".").pop()!)) return false; // numeric TLD = an IP in disguise
  try {
    const ips = await resolve(host);
    return ips.length > 0 && ips.every((ip) => !isPrivateIp(ip));
  } catch {
    return false;
  }
}
