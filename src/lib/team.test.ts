import { describe, expect, it } from "vitest";
import { can, isAdminRole } from "./team";

describe("team rules", () => {
  it("owners and admins invite; members don't", () => {
    expect(can("invite", "owner", null)).toBe(true);
    expect(can("invite", "admin", null)).toBe(true);
    expect(can("invite", "member", null)).toBe(false);
  });

  it("removing", () => {
    expect(can("remove", "owner", "admin")).toBe(true);
    expect(can("remove", "owner", "member")).toBe(true);
    expect(can("remove", "admin", "member")).toBe(true);
    expect(can("remove", "admin", "admin")).toBe(false);
    expect(can("remove", "admin", "owner")).toBe(false);
    expect(can("remove", "member", "member")).toBe(false);
    expect(can("remove", "member", "member", true)).toBe(true); // leave
    expect(can("remove", "owner", "owner", true)).toBe(false); // transfer first
  });

  it("only the owner changes roles and transfers ownership", () => {
    expect(can("change_role", "owner", "member")).toBe(true);
    expect(can("change_role", "admin", "member")).toBe(false);
    expect(can("transfer", "owner", "admin")).toBe(true);
    expect(can("transfer", "admin", "member")).toBe(false);
    expect(can("transfer", "owner", "owner", true)).toBe(false);
  });

  it("admin roles", () => {
    expect([isAdminRole("owner"), isAdminRole("admin"), isAdminRole("member"), isAdminRole(null)]).toEqual([true, true, false, false]);
  });
});
