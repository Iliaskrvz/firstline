import "server-only";
import { cookies } from "next/headers";
import { notFound, redirect } from "next/navigation";
import { isAdmin } from "@/lib/admin";
import { createClient } from "@/lib/supabase/server";
import { isAdminRole, type Role } from "@/lib/team";

export type CurrentUser = { id: string; email: string | null };
export type Workspace = { id: string; name: string };

/** Verified user from the session JWT. Redirects to /login when signed out. */
export async function requireUser() {
  const supabase = await createClient();
  const { data } = await supabase.auth.getClaims();
  const claims = data?.claims;
  if (!claims?.sub) redirect("/login");
  const user: CurrentUser = { id: claims.sub, email: (claims.email as string | undefined) ?? null };
  return { supabase, user };
}

/** Cookie with the workspace the user last switched to (Phase 10: a user can be in several). */
export const WORKSPACE_COOKIE = "fl_ws";

export type WorkspaceChoice = { id: string; name: string; role: Role };

/**
 * The current workspace: the one in the cookie if the user is (still) a member of it, else their
 * first. Membership is read through RLS on every request, so a removed member loses access at once.
 */
export async function requireWorkspace() {
  const { supabase, user } = await requireUser();
  const { data, error } = await supabase
    .from("workspace_members")
    .select("workspace_id, role, workspaces(id, name)")
    .eq("user_id", user.id)
    .order("created_at", { ascending: true });
  if (error) throw error;
  const memberships: WorkspaceChoice[] = (data ?? [])
    .map((m) => ({ ws: m.workspaces as unknown as Workspace | null, role: m.role as Role }))
    .filter((m): m is { ws: Workspace; role: Role } => !!m.ws)
    .map((m) => ({ id: m.ws.id, name: m.ws.name, role: m.role }));
  if (!memberships.length) throw new Error("No workspace found for this account.");
  const wanted = (await cookies()).get(WORKSPACE_COOKIE)?.value;
  const current = memberships.find((m) => m.id === wanted) ?? memberships[0];
  const workspace: Workspace = { id: current.id, name: current.name };
  return { supabase, user, workspace, role: current.role, memberships };
}

/** For actions only owners and admins may do (credits, integrations, API keys, team). */
export async function requireWorkspaceAdmin(): Promise<
  ({ ok: true } & Awaited<ReturnType<typeof requireWorkspace>>) | { ok: false; error: string }
> {
  const w = await requireWorkspace();
  if (!isAdminRole(w.role)) return { ok: false, error: "Only the workspace owner or an admin can do this." };
  return { ok: true, ...w };
}

/** /admin is for ADMIN_EMAILS only; anyone else gets a plain 404. */
export async function requireAdmin() {
  const { supabase, user } = await requireUser();
  if (!isAdmin(user.email)) notFound();
  return { supabase, user };
}
