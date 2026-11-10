// The address the visitor actually used. Behind Caddy on the VPS, Next.js only sees its own
// 127.0.0.1:3100, so redirects built from request.url would send people to localhost.

type HeaderBag = { get(name: string): string | null };

const HOST = /^[a-z0-9.-]+(:\d{1,5})?$/i;

/**
 * Origin from X-Forwarded-Host/Proto (set by Caddy), else the Host header, else the fallback.
 * Only well-formed host names are accepted, so a forged header can't produce a strange URL.
 */
export function publicOrigin(headers: HeaderBag, fallback: string): string {
  const fwdHost = headers.get("x-forwarded-host")?.split(",")[0]?.trim();
  const host = fwdHost && HOST.test(fwdHost) ? fwdHost : headers.get("host")?.trim();
  if (!host || !HOST.test(host)) return fallback;
  const fwdProto = headers.get("x-forwarded-proto")?.split(",")[0]?.trim().toLowerCase();
  const proto = fwdProto === "https" || fwdProto === "http" ? fwdProto : new URL(fallback).protocol.replace(":", "");
  return `${proto}://${host}`;
}

/** A same-site URL for a redirect, on the visitor's real address. */
export function publicUrl(headers: HeaderBag, fallbackOrigin: string, pathAndQuery: string): URL {
  return new URL(pathAndQuery, publicOrigin(headers, fallbackOrigin));
}
