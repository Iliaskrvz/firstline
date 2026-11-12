"use server";

import { cookies } from "next/headers";
import { z } from "zod";
import { requireWorkspace, WORKSPACE_COOKIE } from "@/lib/auth";

/** Switch the current workspace (only to one the user is a member of). */
export async function switchWorkspace(id: string): Promise<{ error: string } | { ok: true }> {
  if (!z.uuid().safeParse(id).success) return { error: "Invalid workspace." };
  const { memberships } = await requireWorkspace();
  if (!memberships.some((m) => m.id === id)) return { error: "You're not a member of that workspace." };
  (await cookies()).set(WORKSPACE_COOKIE, id, { path: "/", httpOnly: true, sameSite: "lax", secure: process.env.NODE_ENV === "production", maxAge: 60 * 60 * 24 * 365 });
  return { ok: true };
}
