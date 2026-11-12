import { describe, expect, it } from "vitest";
import { friendlyAuthError, normalisePassword, passwordProblem } from "./auth-messages";

describe("password rules", () => {
  it("asks for 10+ characters and rejects easy ones", () => {
    expect(passwordProblem("short")).toMatch(/at least 10/);
    expect(passwordProblem("aaaaaaaaaaaa")).toMatch(/repeat/);
    expect(passwordProblem("annavries-2026!", "annavries@acme.nl")).toMatch(/email/);
    expect(passwordProblem("password123")).toMatch(/easy/);
    expect(passwordProblem("blue-kettle-orbit-7")).toBeNull();
  });

  it("accepts every kind of character: accents, other scripts, spaces, symbols, emoji", () => {
    for (const pw of ["Crème brûlée 2026!", "Ærø-ølstue-ÅÄÖ", "Привет мир 123", "密码是很长的一句话吗", "<>{}[]|\\^~`'\"%&§", "🔑🍞🥐🥖🧁🍰🎂🍪🍩🥨"]) {
      expect(passwordProblem(pw)).toBeNull();
    }
    expect(passwordProblem("🔑🔑🔑🔑🔑🔑🔑🔑🔑🔑")).toMatch(/repeat/); // one emoji repeated is still one character repeated
    expect(passwordProblem("🔑🍞🥐🥖🧁🍰🎂🍪🍩")).toMatch(/at least 10/); // 9 emoji = 9 characters, not 18
  });

  it("limits by bytes (bcrypt reads 72) and normalises accents so every keyboard gives the same password", () => {
    expect(passwordProblem("a".repeat(72))).toMatch(/repeat/);
    expect(passwordProblem("ab".repeat(36))).toBeNull();
    expect(passwordProblem("éa".repeat(25))).toMatch(/too long/); // 50 characters, 75 bytes
    const composed = "Caf\u00e9-terras-2026";
    const decomposed = "Cafe\u0301-terras-2026";
    expect(composed).not.toBe(decomposed);
    expect(normalisePassword(decomposed)).toBe(composed);
  });
});

describe("auth errors in plain words", () => {
  it("maps Supabase codes", () => {
    expect(friendlyAuthError({ code: "invalid_credentials", message: "Invalid login credentials" })).toBe("Wrong email or password.");
    expect(friendlyAuthError({ code: "email_not_confirmed" })).toMatch(/Confirm your email/);
    expect(friendlyAuthError({ code: "user_already_exists" })).toBe("Check your inbox to continue.");
    expect(friendlyAuthError({ code: "over_email_send_rate_limit" })).toMatch(/Too many/);
    expect(friendlyAuthError({ name: "NotAllowedError", message: "The operation either timed out or was not allowed." })).toBe("Passkey cancelled.");
    expect(friendlyAuthError({ message: "Unsupported provider: provider is not enabled" })).toMatch(/isn't switched on/);
  });
});
