// Team data layer (Phase 10): members, invites, ownership, workspace choice, activity log.
// Framework-agnostic: a pg Pool (the server's connection). Permission checks use src/lib/team.ts.
import { createHash, randomBytes } from "node:crypto";
import type pg from "pg";
import { can, normaliseEmail, type Role } from "@/lib/team";

export type Member = { user_id: string; email: string; role: Role; joined_at: Date };
export type Invite = { id: string; email: string; role: Role; created_at: Date; expires_at: Date };
export type Membership = { workspace_id: string; name: string; role: Role };

const sha = (s: string) => createHash("sha256").update(s).digest("hex");

export class TeamError extends Error {}

async function tx<T>(pool: pg.Pool, fn: (c: pg.PoolClient) => Promise<T>): Promise<T> {
  const c = await pool.connect();
  try {
    await c.query("begin");
    const r = await fn(c);
    await c.query("commit");
    return r;
  } catch (e) {
    await c.query("rollback").catch(() => {});
    throw e;
  } finally {
    c.release();
  }
}

export async function roleOf(pool: pg.Pool | pg.PoolClient, workspaceId: string, userId: string): Promise<Role | null> {
  const { rows } = await pool.query<{ role: Role }>("select role from public.workspace_members where workspace_id = $1 and user_id = $2", [workspaceId, userId]);
  return rows[0]?.role ?? null;
}

export async function membershipsOf(pool: pg.Pool, userId: string): Promise<Membership[]> {
  const { rows } = await pool.query<Membership>(
    `select m.workspace_id, w.name, m.role from public.workspace_members m join public.workspaces w on w.id = m.workspace_id
      where m.user_id = $1 order by m.created_at`,
    [userId],
  );
  return rows;
}

export async function members(pool: pg.Pool, workspaceId: string): Promise<Member[]> {
  const { rows } = await pool.query<Member>(
    `select m.user_id, coalesce(u.email, '') email, m.role, m.created_at joined_at
       from public.workspace_members m left join auth.users u on u.id = m.user_id
      where m.workspace_id = $1
      order by case m.role when 'owner' then 0 when 'admin' then 1 else 2 end, m.created_at`,
    [workspaceId],
  );
  return rows;
}

export async function openInvites(pool: pg.Pool, workspaceId: string): Promise<Invite[]> {
  const { rows } = await pool.query<Invite>(
    "select id, email, role, created_at, expires_at from public.workspace_invites where workspace_id = $1 and accepted_at is null and revoked_at is null and expires_at > now() order by created_at desc",
    [workspaceId],
  );
  return rows;
}

/** Create (or renew) an invite. Returns the one-time token for the link; only its hash is stored. */
export async function invite(pool: pg.Pool, p: { workspaceId: string; actor: { id: string; role: Role }; email: string; role: "admin" | "member" }): Promise<{ token: string; inviteId: string }> {
  if (!can("invite", p.actor.role, null)) throw new TeamError("Only owners and admins can invite people.");
  const email = normaliseEmail(p.email);
  return tx(pool, async (c) => {
    const { rows: already } = await c.query(
      "select 1 from public.workspace_members m join auth.users u on u.id = m.user_id where m.workspace_id = $1 and lower(u.email) = $2",
      [p.workspaceId, email],
    );
    if (already[0]) throw new TeamError(`${email} is already in this workspace.`);
    // A new invite to the same address replaces the open one (new link, new 7 days).
    await c.query("update public.workspace_invites set revoked_at = now() where workspace_id = $1 and lower(email) = $2 and accepted_at is null and revoked_at is null", [p.workspaceId, email]);
    const token = randomBytes(24).toString("base64url");
    const { rows } = await c.query<{ id: string }>(
      "insert into public.workspace_invites (workspace_id, email, role, token_hash, invited_by) values ($1, $2, $3, $4, $5) returning id",
      [p.workspaceId, email, p.role, sha(token), p.actor.id],
    );
    return { token, inviteId: rows[0].id };
  });
}

export async function revokeInvite(pool: pg.Pool, workspaceId: string, actorRole: Role, inviteId: string): Promise<void> {
  if (!can("invite", actorRole, null)) throw new TeamError("Only owners and admins can cancel invites.");
  await pool.query("update public.workspace_invites set revoked_at = now() where id = $1 and workspace_id = $2 and accepted_at is null", [inviteId, workspaceId]);
}

export type InviteInfo = { id: string; workspace_id: string; workspace_name: string; email: string; role: Role; status: "open" | "accepted" | "expired" | "revoked" };

export async function inviteByToken(pool: pg.Pool, token: string): Promise<InviteInfo | null> {
  const { rows } = await pool.query<InviteInfo & { accepted_at: Date | null; revoked_at: Date | null; expires_at: Date }>(
    `select i.id, i.workspace_id, w.name workspace_name, i.email, i.role, i.accepted_at, i.revoked_at, i.expires_at
       from public.workspace_invites i join public.workspaces w on w.id = i.workspace_id where i.token_hash = $1`,
    [sha(token)],
  );
  const r = rows[0];
  if (!r) return null;
  const status = r.accepted_at ? "accepted" : r.revoked_at ? "revoked" : r.expires_at < new Date() ? "expired" : "open";
  return { id: r.id, workspace_id: r.workspace_id, workspace_name: r.workspace_name, email: r.email, role: r.role, status };
}

/** The signed-in user joins with the invite's role. Their email must be the invited one. */
export async function acceptInvite(pool: pg.Pool, token: string, user: { id: string; email: string | null }): Promise<{ workspaceId: string; role: Role }> {
  return tx(pool, async (c) => {
    const { rows } = await c.query<{ id: string; workspace_id: string; email: string; role: Role; accepted_at: Date | null; revoked_at: Date | null; expires_at: Date }>(
      "select id, workspace_id, email, role, accepted_at, revoked_at, expires_at from public.workspace_invites where token_hash = $1 for update",
      [sha(token)],
    );
    const i = rows[0];
    if (!i || i.revoked_at) throw new TeamError("This invite link is not valid (anymore). Ask for a new one.");
    if (i.accepted_at) throw new TeamError("This invite was already used.");
    if (i.expires_at < new Date()) throw new TeamError("This invite has expired. Ask for a new one.");
    if (normaliseEmail(user.email ?? "") !== normaliseEmail(i.email)) {
      throw new TeamError(`This invite is for ${i.email}. Sign in with that address to accept it.`);
    }
    await c.query(
      "insert into public.workspace_members (workspace_id, user_id, role) values ($1, $2, $3) on conflict (workspace_id, user_id) do nothing",
      [i.workspace_id, user.id, i.role],
    );
    await c.query("update public.workspace_invites set accepted_at = now(), accepted_by = $2 where id = $1", [i.id, user.id]);
    return { workspaceId: i.workspace_id, role: i.role };
  });
}

/** Remove someone (or leave). Access ends at once: every query checks membership. */
export async function removeMember(pool: pg.Pool, p: { workspaceId: string; actor: { id: string; role: Role }; userId: string }): Promise<void> {
  const target = await roleOf(pool, p.workspaceId, p.userId);
  if (!target) throw new TeamError("Not a member of this workspace.");
  if (!can("remove", p.actor.role, target, p.actor.id === p.userId)) {
    throw new TeamError(target === "owner" ? "The owner can't be removed. Transfer ownership first." : "You can't remove this person.");
  }
  await pool.query("delete from public.workspace_members where workspace_id = $1 and user_id = $2 and role <> 'owner'", [p.workspaceId, p.userId]);
}

export async function changeRole(pool: pg.Pool, p: { workspaceId: string; actor: { id: string; role: Role }; userId: string; role: "admin" | "member" }): Promise<void> {
  const target = await roleOf(pool, p.workspaceId, p.userId);
  if (!target || !can("change_role", p.actor.role, target, p.actor.id === p.userId)) throw new TeamError("Only the owner can change roles.");
  await pool.query("update public.workspace_members set role = $3 where workspace_id = $1 and user_id = $2 and role <> 'owner'", [p.workspaceId, p.userId, p.role]);
}

/** The owner hands the workspace to another member; the old owner becomes an admin. */
export async function transferOwnership(pool: pg.Pool, p: { workspaceId: string; actor: { id: string; role: Role }; toUserId: string }): Promise<void> {
  await tx(pool, async (c) => {
    await c.query("select 1 from public.workspaces where id = $1 for update", [p.workspaceId]);
    const actorRole = await roleOf(c, p.workspaceId, p.actor.id);
    const target = await roleOf(c, p.workspaceId, p.toUserId);
    if (!actorRole || !can("transfer", actorRole, target, p.actor.id === p.toUserId)) throw new TeamError("Only the owner can transfer ownership, to someone already in the team.");
    await c.query("update public.workspace_members set role = 'admin' where workspace_id = $1 and user_id = $2", [p.workspaceId, p.actor.id]);
    await c.query("update public.workspace_members set role = 'owner' where workspace_id = $1 and user_id = $2", [p.workspaceId, p.toUserId]);
    await c.query("update public.workspaces set owner_id = $2 where id = $1", [p.workspaceId, p.toUserId]);
  });
}

// ---- Activity log -----------------------------------------------------------------------

export type ActivityInput = { workspaceId: string; userId: string | null; actor: string; action: string; target?: string | null; details?: Record<string, unknown> };
export type ActivityRow = { id: number; actor: string; action: string; target: string | null; details: Record<string, unknown>; created_at: Date };

/** Never throws: a failed log line must not break the action itself. */
export async function logActivity(pool: pg.Pool | pg.PoolClient, a: ActivityInput): Promise<void> {
  await pool
    .query("insert into public.activity_log (workspace_id, user_id, actor, action, target, details) values ($1, $2, $3, $4, $5, $6)", [
      a.workspaceId,
      a.userId,
      a.actor.slice(0, 200),
      a.action,
      a.target?.slice(0, 300) ?? null,
      JSON.stringify(a.details ?? {}),
    ])
    .catch((e) => console.error("activity log failed:", (e as Error).message));
}

export async function activity(pool: pg.Pool, workspaceId: string, limit = 200): Promise<ActivityRow[]> {
  const { rows } = await pool.query<ActivityRow>("select id, actor, action, target, details, created_at from public.activity_log where workspace_id = $1 order by created_at desc, id desc limit $2", [
    workspaceId,
    limit,
  ]);
  return rows;
}
