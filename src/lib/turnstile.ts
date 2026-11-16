// Cloudflare Turnstile: proves the public demo is used by a person, not a script.
// Server side: POST the widget's token to siteverify with our secret (TURNSTILE_SECRET_KEY).
const SITEVERIFY = "https://challenges.cloudflare.com/turnstile/v0/siteverify";

type FetchLike = (url: string, init: { method: string; body: URLSearchParams; signal?: AbortSignal }) => Promise<{ ok: boolean; json(): Promise<unknown> }>;

export async function verifyTurnstile(token: string, ip: string | null, secret: string, fetchImpl: FetchLike = (u, i) => fetch(u, i)): Promise<boolean> {
  if (!token || token.length > 2048 || !secret) return false;
  const body = new URLSearchParams({ secret, response: token });
  if (ip) body.set("remoteip", ip);
  try {
    const res = await fetchImpl(SITEVERIFY, { method: "POST", body, signal: AbortSignal.timeout(8_000) });
    if (!res.ok) return false;
    const j = (await res.json()) as { success?: boolean };
    return j.success === true;
  } catch {
    return false;
  }
}
