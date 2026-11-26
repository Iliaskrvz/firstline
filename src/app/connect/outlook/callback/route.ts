// GET /connect/outlook/callback: Microsoft sends the user back here after signing in.
// Consent missing (their organisation needs an admin to approve FirstLine) → the approval screen.
import { NextResponse, type NextRequest } from "next/server";
import { requireWorkspace } from "@/lib/auth";
import { encryptionKey } from "@/lib/secret-box";
import { isConsentError, MicrosoftAuthError, missingScopes } from "@/sender/microsoft";
import { microsoftAuth, microsoftGraph } from "@/sender/microsoft-config";
import { connectOutlookInbox } from "@/sender/outlook";
import { connectOrigin, redirectUri, takeConnectState } from "@/server/outlook-connect";
import { serverPool } from "@/server/db";
import { logActivity } from "@/teams/db";

export async function GET(request: NextRequest) {
  const origin = connectOrigin(request.headers, request.nextUrl.origin);
  const q = request.nextUrl.searchParams;
  const to = (path: string) => NextResponse.redirect(new URL(path, origin));
  const saved = await takeConnectState(q.get("state"));
  if (!saved) return to("/inboxes?outlook=expired");
  const { user, memberships } = await requireWorkspace();
  if (user.id !== saved.userId || !memberships.some((m) => m.id === saved.workspaceId)) return to("/inboxes?outlook=expired");

  const error = q.get("error");
  if (error) {
    const code = q.get("error_description")?.match(/AADSTS\d+/)?.[0] ?? error;
    return to(isConsentError(error, q.get("error_description")) ? `/inboxes/outlook?need=admin&code=${encodeURIComponent(code)}` : `/inboxes?outlook=error&code=${encodeURIComponent(code)}`);
  }
  const code = q.get("code");
  if (!code) return to("/inboxes?outlook=error");

  try {
    const tokens = await microsoftAuth().exchangeCode(code, saved.verifier, redirectUri(origin));
    const missing = missingScopes(tokens.scope);
    if (missing.length) return to(`/inboxes/outlook?need=admin&missing=${encodeURIComponent(missing.join(","))}`);
    const me = await microsoftGraph(tokens.accessToken).me();
    const window = { days: [1, 2, 3, 4, 5], start: "08:30", end: "17:00", tz: saved.tz };
    const pool = serverPool();
    const { inboxId } = await connectOutlookInbox(pool, encryptionKey(), { workspaceId: saved.workspaceId, email: me.email, tokens, window });
    await logActivity(pool, { workspaceId: saved.workspaceId, userId: user.id, actor: user.email ?? "Member", action: "inbox.connected", target: me.email, details: { provider: "microsoft", inbox: inboxId } }).catch(() => {});
    return to(`/inboxes?connected=outlook`);
  } catch (e) {
    const reason = e instanceof MicrosoftAuthError ? (e.code ?? "token") : "connect";
    console.error("outlook connect:", (e as Error).message);
    return to(`/inboxes?outlook=error&code=${encodeURIComponent(reason)}`);
  }
}
