// Encrypt customer secrets (sending-tool API keys, webhook tokens) at rest (§11).
// AES-256-GCM with a 32-byte key from INTEGRATIONS_ENCRYPTION_KEY (base64). Format: "v1:<base64 iv|tag|ciphertext>".
import { createCipheriv, createDecipheriv, randomBytes, timingSafeEqual } from "node:crypto";

export class MissingEncryptionKeyError extends Error {
  constructor() {
    super("INTEGRATIONS_ENCRYPTION_KEY is not set (32 random bytes, base64).");
  }
}

export function encryptionKey(env: Record<string, string | undefined> = process.env): Buffer {
  const raw = env.INTEGRATIONS_ENCRYPTION_KEY?.trim();
  if (!raw) throw new MissingEncryptionKeyError();
  const key = Buffer.from(raw, "base64");
  if (key.length !== 32) throw new Error("INTEGRATIONS_ENCRYPTION_KEY must be 32 bytes, base64-encoded.");
  return key;
}

export function encryptionConfigured(env: Record<string, string | undefined> = process.env): boolean {
  try {
    encryptionKey(env);
    return true;
  } catch {
    return false;
  }
}

export function encryptSecret(plain: string, key: Buffer): string {
  const iv = randomBytes(12);
  const c = createCipheriv("aes-256-gcm", key, iv);
  const ct = Buffer.concat([c.update(plain, "utf8"), c.final()]);
  return `v1:${Buffer.concat([iv, c.getAuthTag(), ct]).toString("base64")}`;
}

export function decryptSecret(box: string, key: Buffer): string {
  if (!box.startsWith("v1:")) throw new Error("Unknown secret format");
  const buf = Buffer.from(box.slice(3), "base64");
  const d = createDecipheriv("aes-256-gcm", key, buf.subarray(0, 12));
  d.setAuthTag(buf.subarray(12, 28));
  return Buffer.concat([d.update(buf.subarray(28)), d.final()]).toString("utf8");
}

/** Random URL-safe token (webhook URLs). */
export function randomToken(bytes = 24): string {
  return randomBytes(bytes).toString("base64url");
}

export function safeEqual(a: string, b: string): boolean {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}

/** "…ab12": enough to recognise a key, never enough to use it. */
export function keyHint(key: string): string {
  return key.trim().slice(-4);
}
