// API keys (§ Phase 9): "fl_live_" + 32 random base62 characters. Shown once, stored as SHA-256.
import { createHash, randomBytes } from "node:crypto";

export const KEY_PREFIX = "fl_live_";
const ALPHABET = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz";

export function generateApiKey(rand: (n: number) => Buffer = randomBytes): { key: string; prefix: string; hash: string } {
  const bytes = rand(32);
  let body = "";
  for (const b of bytes) body += ALPHABET[b % 62];
  const key = `${KEY_PREFIX}${body}`;
  return { key, prefix: key.slice(0, KEY_PREFIX.length + 4), hash: hashApiKey(key) };
}

export function hashApiKey(key: string): string {
  return createHash("sha256").update(key.trim()).digest("hex");
}

/** "Bearer fl_live_…" (or a bare key, for tools that can only set a plain header value). */
export function keyFromAuthHeader(header: string | null): string | null {
  if (!header) return null;
  const v = header.trim().replace(/^Bearer\s+/i, "");
  return /^fl_live_[0-9A-Za-z]{32}$/.test(v) ? v : null;
}
