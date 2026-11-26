// GET /connect/outlook/start?tz=…: sign in with Microsoft 365 to connect an inbox (work/school accounts).
import { NextResponse, type NextRequest } from "next/server";
import { requireWorkspace } from "@/lib/auth";
import { encryptionConfigured, randomToken } from "@/lib/secret-box";
import { authorizeUrl, pkcePair } from "@/sender/microsoft";
import { microsoftMode } from "@/sender/microsoft-config";
import { connectOrigin, redirectUri, saveConnectState, validTimeZone } from "@/server/outlook-connect";

export async function GET(request: NextRequest) {
  const origin = connectOrigin(request.headers, request.nextUrl.origin);
  const mode = microsoftMode();
  if (mode === "off") return NextResponse.redirect(new URL("/inboxes?outlook=off", origin));
  if (!encryptionConfigured()) return NextResponse.redirect(new URL("/inboxes?outlook=nokey", origin));
  const { user, workspace } = await requireWorkspace();
  const { verifier, challenge } = pkcePair();
  const state = randomToken(24);
  await saveConnectState({ state, verifier, workspaceId: workspace.id, userId: user.id, tz: validTimeZone(request.nextUrl.searchParams.get("tz")) });
  if (mode === "fake") return NextResponse.redirect(new URL(`/connect/outlook/fake?state=${encodeURIComponent(state)}`, origin));
  return NextResponse.redirect(authorizeUrl({ clientId: process.env.MICROSOFT_CLIENT_ID!.trim(), redirectUri: redirectUri(origin), state, codeChallenge: challenge, loginHint: user.email }));
}
