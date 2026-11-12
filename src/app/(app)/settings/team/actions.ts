"use server";

import { revalidatePath } from "next/cache";
import { headers } from "next/headers";
import { z } from "zod";
import { requireWorkspace } from "@/lib/auth";
import { publicOrigin } from "@/lib/public-origin";
import { ROLE_LABEL } from "@/lib/team";
import { resendMailer } from "@/sender/alerts";
import { logAction } from "@/server/activity";
import { serverPool } from "@/server/db";
import { queueConfigured } from "@/server/queue";
import { changeRole, invite, removeMember, revokeInvite, TeamError, transferOwnership } from "@/teams/db";

const NOT_READY = "Teams need the database connection (DATABASE_URL in .env.local).";

async function guard<T>(fn: () => Promise<T>): Promise<T | { error: string }> {
  if (!queueConfigured()) return { error: NOT_READY };
  try {
    return await fn();
  } catch (e) {
    if (e instanceof TeamError) return { error: e.message };
    throw e;
  }
}

const Invite = z.object({ email: z.email("Enter a valid email address.").max(254), role: z.enum(["admin", "member"]) });

/** Returns the invite link; it is also emailed when email sending (Resend) is set up. */
export async function inviteMember(input: z.input<typeof Invite>): Promise<{ error: string } | { link: string; emailed: boolean }> {
  const p = Invite.safeParse(input);
  if (!p.success) return { error: p.error.issues[0].message };
  return guard(async () => {
    const w = await requireWorkspace();
    const { token } = await invite(serverPool(), { workspaceId: w.workspace.id, actor: { id: w.user.id, role: w.role }, email: p.data.email, role: p.data.role });
    const origin = process.env.PUBLIC_APP_URL?.trim().replace(/\/+$/, "") || publicOrigin(await headers(), "http://localhost:3000");
    const link = `${origin}/invite/${token}`;
    let emailed = false;
    const key = process.env.RESEND_API_KEY?.trim();
    if (key) {
      await resendMailer(key, process.env.ALERT_FROM_EMAIL?.trim() || "FirstLine <onboarding@resend.dev>")
        .send({
          to: p.data.email,
          subject: `${w.user.email ?? "Someone"} invited you to ${w.workspace.name} on FirstLine`,
          text: `${w.user.email ?? "Someone"} invited you to join "${w.workspace.name}" on FirstLine as ${ROLE_LABEL[p.data.role].toLowerCase()}.\n\nAccept the invite (valid for 7 days): ${link}\n\nSign in with this email address (${p.data.email}). If you didn't expect this, ignore this email.`,
        })
        .then(() => (emailed = true))
        .catch((e) => console.error("invite email failed:", (e as Error).message));
    }
    await logAction(w, "member.invited", p.data.email.toLowerCase(), { role: p.data.role });
    revalidatePath("/settings/team");
    return { link, emailed };
  });
}

export async function cancelInvite(inviteId: string): Promise<{ error: string } | { ok: true }> {
  if (!z.uuid().safeParse(inviteId).success) return { error: "Invalid invite." };
  return guard(async () => {
    const w = await requireWorkspace();
    await revokeInvite(serverPool(), w.workspace.id, w.role, inviteId);
    await logAction(w, "member.invite_cancelled", inviteId);
    revalidatePath("/settings/team");
    return { ok: true as const };
  });
}

export async function removeFromTeam(userId: string, email: string): Promise<{ error: string } | { ok: true; left: boolean }> {
  if (!z.uuid().safeParse(userId).success) return { error: "Invalid member." };
  return guard(async () => {
    const w = await requireWorkspace();
    await removeMember(serverPool(), { workspaceId: w.workspace.id, actor: { id: w.user.id, role: w.role }, userId });
    const left = userId === w.user.id;
    await logAction(w, left ? "member.left" : "member.removed", email);
    revalidatePath("/settings/team");
    return { ok: true as const, left };
  });
}

export async function setRole(userId: string, email: string, role: "admin" | "member"): Promise<{ error: string } | { ok: true }> {
  if (!z.uuid().safeParse(userId).success || !["admin", "member"].includes(role)) return { error: "Invalid change." };
  return guard(async () => {
    const w = await requireWorkspace();
    await changeRole(serverPool(), { workspaceId: w.workspace.id, actor: { id: w.user.id, role: w.role }, userId, role });
    await logAction(w, "member.role_changed", email, { role });
    revalidatePath("/settings/team");
    return { ok: true as const };
  });
}

export async function makeOwner(userId: string, email: string): Promise<{ error: string } | { ok: true }> {
  if (!z.uuid().safeParse(userId).success) return { error: "Invalid member." };
  return guard(async () => {
    const w = await requireWorkspace();
    await transferOwnership(serverPool(), { workspaceId: w.workspace.id, actor: { id: w.user.id, role: w.role }, toUserId: userId });
    await logAction(w, "workspace.ownership_transferred", email);
    revalidatePath("/settings/team");
    return { ok: true as const };
  });
}
