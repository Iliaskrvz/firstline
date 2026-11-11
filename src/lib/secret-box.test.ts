import { randomBytes } from "node:crypto";
import { describe, expect, it } from "vitest";
import { decryptSecret, encryptionConfigured, encryptionKey, encryptSecret, keyHint, safeEqual } from "./secret-box";

describe("secret box", () => {
  const key = randomBytes(32);

  it("round-trips and never stores the plain text", () => {
    const box = encryptSecret("my-api-key-123", key);
    expect(box.startsWith("v1:")).toBe(true);
    expect(box).not.toContain("my-api-key");
    expect(decryptSecret(box, key)).toBe("my-api-key-123");
    expect(encryptSecret("same", key)).not.toBe(encryptSecret("same", key)); // random IV
  });

  it("rejects a wrong key or tampered data", () => {
    const box = encryptSecret("secret", key);
    expect(() => decryptSecret(box, randomBytes(32))).toThrow();
    const raw = Buffer.from(box.slice(3), "base64");
    raw[raw.length - 1] ^= 1;
    expect(() => decryptSecret(`v1:${raw.toString("base64")}`, key)).toThrow();
  });

  it("reads the key from settings", () => {
    expect(encryptionConfigured({})).toBe(false);
    expect(encryptionConfigured({ INTEGRATIONS_ENCRYPTION_KEY: "short" })).toBe(false);
    expect(encryptionKey({ INTEGRATIONS_ENCRYPTION_KEY: key.toString("base64") }).equals(key)).toBe(true);
  });

  it("helpers", () => {
    expect(keyHint(" abcdef1234 ")).toBe("1234");
    expect(safeEqual("abc", "abc")).toBe(true);
    expect(safeEqual("abc", "abd")).toBe(false);
    expect(safeEqual("abc", "abcd")).toBe(false);
  });
});
