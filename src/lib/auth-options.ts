import "server-only";
import { supabaseEnv } from "@/lib/supabase/env";

/**
 * Which optional sign-in methods the Supabase project has switched on, read from its public auth
 * settings. Buttons for methods that are off are hidden: a Google click on a project without the
 * Google provider would otherwise land on a raw JSON error page from Supabase.
 */
export type SignInOptions = { google: boolean; passkeys: boolean };

const OFF: SignInOptions = { google: false, passkeys: false };
const TTL_MS = 60_000;
let cached: { at: number; value: SignInOptions } | null = null;

export function parseSignInOptions(settings: unknown): SignInOptions {
  const s = (settings ?? {}) as { external?: { google?: unknown }; passkeys_enabled?: unknown };
  return { google: s.external?.google === true, passkeys: s.passkeys_enabled === true };
}

export async function signInOptions(fetchImpl: typeof fetch = fetch, now = Date.now()): Promise<SignInOptions> {
  if (cached && now - cached.at < TTL_MS) return cached.value;
  try {
    const { url, key } = supabaseEnv();
    const r = await fetchImpl(`${url}/auth/v1/settings`, { headers: { apikey: key }, cache: "no-store", signal: AbortSignal.timeout(3_000) });
    if (!r.ok) return OFF; // not cached: try again on the next request
    const value = parseSignInOptions(await r.json());
    cached = { at: now, value };
    return value;
  } catch {
    return OFF;
  }
}

/** Tests only. */
export function resetSignInOptionsCache() {
  cached = null;
}
