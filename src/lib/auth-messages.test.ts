import { describe, expect, it } from "vitest";
import { friendlyAuthError, passwordProblem } from "./auth-messages";

describe("password rules", () => {
  it("asks for 10+ characters and rejects easy ones", () => {
    expect(passwordProblem("short")).toMatch(/at least 10/);
    expect(passwordProblem("aaaaaaaaaaaa")).toMatch(/repeat/);
    expect(passwordProblem("annavries-2026!", "annavries@acme.nl")).toMatch(/email/);
    expect(passwordProblem("password123")).toMatch(/easy/);
    expect(passwordProblem("blue-kettle-orbit-7")).toBeNull();
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
