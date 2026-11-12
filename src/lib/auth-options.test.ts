import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
const { parseSignInOptions, resetSignInOptionsCache, signInOptions } = await import("./auth-options");

// Recorded shape of GET /auth/v1/settings from a local Supabase (auth v2.x), trimmed.
const RECORDED = {
  external: { anonymous_users: false, apple: false, email: true, google: false, github: false, phone: false },
  disable_signup: false,
  mailer_autoconfirm: false,
  phone_autoconfirm: false,
  sms_provider: "twilio",
  saml_enabled: false,
  passkeys_enabled: true,
};

const json = (body: unknown, status = 200) => vi.fn(async () => new Response(JSON.stringify(body), { status })) as unknown as typeof fetch;

describe("sign-in options", () => {
  beforeEach(() => {
    resetSignInOptionsCache();
    process.env.NEXT_PUBLIC_SUPABASE_URL = "http://127.0.0.1:55321";
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY = "test-key";
  });

  it("reads Google and passkeys from the project's auth settings", async () => {
    expect(parseSignInOptions(RECORDED)).toEqual({ google: false, passkeys: true });
    expect(parseSignInOptions({ ...RECORDED, external: { google: true }, passkeys_enabled: false })).toEqual({ google: true, passkeys: false });
    expect(parseSignInOptions(null)).toEqual({ google: false, passkeys: false });
  });

  it("asks once a minute, and hides both buttons when the settings can't be read", async () => {
    const f = json(RECORDED);
    expect(await signInOptions(f, 0)).toEqual({ google: false, passkeys: true });
    await signInOptions(f, 30_000);
    expect(f).toHaveBeenCalledTimes(1);
    await signInOptions(f, 61_000);
    expect(f).toHaveBeenCalledTimes(2);

    resetSignInOptionsCache();
    expect(await signInOptions(json({ msg: "down" }, 503), 0)).toEqual({ google: false, passkeys: false });
    const broken = vi.fn(async () => {
      throw new Error("ECONNREFUSED");
    }) as unknown as typeof fetch;
    expect(await signInOptions(broken, 0)).toEqual({ google: false, passkeys: false });
  });
});
