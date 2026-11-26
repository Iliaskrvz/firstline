// Real or fake Microsoft for the Outlook lane, shared by the web app and the worker (so no "server-only").
//   real: MICROSOFT_CLIENT_ID + MICROSOFT_CLIENT_SECRET set (the FirstLine Entra app)
//   fake: MICROSOFT_CLIENT_ID=fake-microsoft, or no client id outside production (tests, local dev)
//   off:  production without a client id: "Connect Outlook" is hidden
import { realGraphMail, realMicrosoftAuth, type GraphMail, type MicrosoftAuth } from "./microsoft";
import { FakeMicrosoft } from "./microsoft-fake";

export type MicrosoftMode = "real" | "fake" | "off";

export function microsoftMode(env: Record<string, string | undefined> = process.env): MicrosoftMode {
  const id = env.MICROSOFT_CLIENT_ID?.trim();
  if (id === "fake-microsoft" || (!id && env.NODE_ENV !== "production")) return "fake";
  return id && env.MICROSOFT_CLIENT_SECRET?.trim() ? "real" : "off";
}

let fake: FakeMicrosoft | null = null;
/** One fake per process; fake tokens carry the address, so the web app and the worker agree. */
export function fakeMicrosoft(): FakeMicrosoft {
  fake ??= new FakeMicrosoft();
  return fake;
}

export function microsoftAuth(env: Record<string, string | undefined> = process.env): MicrosoftAuth {
  if (microsoftMode(env) === "fake") return fakeMicrosoft().auth();
  return realMicrosoftAuth(env.MICROSOFT_CLIENT_ID!.trim(), env.MICROSOFT_CLIENT_SECRET!.trim());
}

/** Graph for an access token: fake tokens ("fake-at:…") always go to the fake. */
export function microsoftGraph(accessToken: string): GraphMail {
  return accessToken.startsWith("fake-at:") ? fakeMicrosoft().graph(accessToken) : realGraphMail(accessToken);
}

/** The redirect addresses to register on the Entra app (Web platform). */
export const MS_REDIRECTS = { signIn: "/connect/outlook/callback", adminDone: "/connect/outlook/admin-done" } as const;
