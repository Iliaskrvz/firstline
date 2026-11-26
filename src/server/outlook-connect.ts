// "Connect Outlook" (server only): the short-lived, encrypted cookie that carries the sign-in state and
// PKCE verifier from /connect/outlook/start to the callback, and the addresses Microsoft redirects to.
import "server-only";
import { cookies } from "next/headers";
import { publicOrigin } from "@/lib/public-origin";
import { decryptSecret, encryptionKey, encryptSecret, safeEqual } from "@/lib/secret-box";
import { MS_REDIRECTS } from "@/sender/microsoft-config";

const COOKIE = "fl_ms_connect";
const TTL_S = 600;

export type ConnectState = { state: string; verifier: string; workspaceId: string; userId: string; tz: string; exp: number };

export async function saveConnectState(s: Omit<ConnectState, "exp">) {
  const value = encryptSecret(JSON.stringify({ ...s, exp: Date.now() + TTL_S * 1000 }), encryptionKey());
  (await cookies()).set(COOKIE, value, { httpOnly: true, secure: process.env.NODE_ENV === "production", sameSite: "lax", path: "/connect/outlook", maxAge: TTL_S });
}

/** The saved state if it matches what Microsoft sent back and hasn't expired; the cookie is removed either way. */
export async function takeConnectState(state: string | null): Promise<ConnectState | null> {
  const jar = await cookies();
  const raw = jar.get(COOKIE)?.value;
  jar.delete({ name: COOKIE, path: "/connect/outlook" });
  if (!raw || !state) return null;
  try {
    const s = JSON.parse(decryptSecret(raw, encryptionKey())) as ConnectState;
    return s.exp > Date.now() && safeEqual(s.state, state) ? s : null;
  } catch {
    return null;
  }
}

/** Microsoft needs the exact registered address: the public address in production, else this server. */
export function connectOrigin(headers: Headers, fallback: string): string {
  return publicOrigin(headers, process.env.PUBLIC_APP_URL?.trim() || fallback);
}

export const redirectUri = (origin: string) => `${origin}${MS_REDIRECTS.signIn}`;
export const adminDoneUri = (origin: string) => `${origin}${MS_REDIRECTS.adminDone}`;

/** A real IANA timezone, or Amsterdam. */
export function validTimeZone(tz: string | null): string {
  try {
    if (tz && tz.length < 64) {
      new Intl.DateTimeFormat("en", { timeZone: tz });
      return tz;
    }
  } catch {
    /* fall through */
  }
  return "Europe/Amsterdam";
}
