"use server";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { requireUser, WORKSPACE_COOKIE } from "@/lib/auth";
import { serverPool } from "@/server/db";
import { acceptInvite, logActivity, TeamError } from "@/teams/db";

export async function accept(token: string): Promise<{ error: string } | undefined> {
  const { user } = await requireUser();
  let workspaceId: string;
  try {
    const r = await acceptInvite(serverPool(), token, user);
    workspaceId = r.workspaceId;
    await logActivity(serverPool(), { workspaceId, userId: user.id, actor: user.email ?? "new member", action: "member.joined", details: { role: r.role } });
  } catch (e) {
    if (e instanceof TeamError) return { error: e.message };
    throw e;
  }
  (await cookies()).set(WORKSPACE_COOKIE, workspaceId, { path: "/", httpOnly: true, sameSite: "lax", secure: process.env.NODE_ENV === "production", maxAge: 60 * 60 * 24 * 365 });
  redirect("/campaigns");
}
