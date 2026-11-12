// Team rules (Phase 10). Pure: who may do what. Server actions and tests use the same rules.

export type Role = "owner" | "admin" | "member";
export const ROLES: Role[] = ["owner", "admin", "member"];
export const ROLE_LABEL: Record<Role, string> = { owner: "Owner", admin: "Admin", member: "Member" };

/** Buy credits, manage integrations, API keys, webhooks and the team. */
export const isAdminRole = (r: Role | null | undefined): boolean => r === "owner" || r === "admin";

export type TeamAction = "invite" | "remove" | "change_role" | "transfer";

/**
 * - Owners and admins invite (as member or admin).
 * - The owner removes anyone but themselves; admins remove members only. Anyone but the owner may leave.
 * - Only the owner changes roles and transfers ownership (to someone already in the team).
 */
export function can(action: TeamAction, actor: Role, target: Role | null, self = false): boolean {
  switch (action) {
    case "invite":
      return isAdminRole(actor);
    case "remove":
      if (self) return actor !== "owner";
      if (target === "owner") return false;
      return actor === "owner" || (actor === "admin" && target === "member");
    case "change_role":
      return actor === "owner" && !self && target !== "owner";
    case "transfer":
      return actor === "owner" && !self && target !== null && target !== "owner";
  }
}

export function normaliseEmail(e: string): string {
  return e.trim().toLowerCase();
}
