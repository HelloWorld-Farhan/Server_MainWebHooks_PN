import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  canAssignRole,
  canInviteEmployee,
  canManageEmployee,
  getAssignableRoles,
  type AccessContext,
} from "@/lib/permissions-policy";
import { PERMISSIONS } from "@/lib/permissions";

function ctx(partial: Partial<AccessContext> & Pick<AccessContext, "role">): AccessContext {
  return {
    membershipId: "m1",
    userId: "u1",
    permissions: [],
    branchAccessType: "ALL",
    branchIds: [],
    ...partial,
  };
}

describe("access-policy", () => {
  it("owner can assign all roles including owner", () => {
    const owner = ctx({
      role: "OWNER",
      permissions: Object.values(PERMISSIONS),
    });
    assert.deepEqual(getAssignableRoles(owner), [
      "OWNER",
      "ADMIN",
      "MANAGER",
      "AGENT",
      "SALES",
      "SUPPORT",
    ]);
    assert.equal(canAssignRole(owner, "OWNER"), true);
  });

  it("admin cannot assign owner", () => {
    const admin = ctx({
      role: "ADMIN",
      permissions: Object.values(PERMISSIONS).filter(
        (p) => p !== PERMISSIONS.SETTINGS_WRITE && p !== PERMISSIONS.BRANCHES_BULK,
      ),
    });
    assert.equal(canAssignRole(admin, "OWNER"), false);
    assert.equal(canAssignRole(admin, "MANAGER"), true);
  });

  it("manager cannot manage employees", () => {
    const manager = ctx({
      role: "MANAGER",
      permissions: [PERMISSIONS.EMPLOYEES_READ],
    });
    const target = { id: "m2", userId: "u2", role: "AGENT" as const };
    assert.equal(canManageEmployee(manager, target), false);
    assert.equal(canInviteEmployee(manager, "AGENT"), false);
  });

  it("blocks self-management", () => {
    const admin = ctx({
      role: "ADMIN",
      membershipId: "m1",
      userId: "u1",
      permissions: [
        PERMISSIONS.EMPLOYEES_WRITE,
        PERMISSIONS.EMPLOYEES_INVITE,
      ],
    });
    const self = { id: "m1", userId: "u1", role: "ADMIN" as const };
    assert.equal(canManageEmployee(admin, self), false);
    assert.equal(canInviteEmployee(admin, "AGENT", self), false);
  });

  it("only owner manages owner accounts", () => {
    const admin = ctx({
      role: "ADMIN",
      permissions: [PERMISSIONS.EMPLOYEES_WRITE, PERMISSIONS.EMPLOYEES_INVITE],
    });
    const ownerTarget = { id: "m2", userId: "u2", role: "OWNER" as const };
    assert.equal(canManageEmployee(admin, ownerTarget), false);
    assert.equal(canInviteEmployee(admin, "SALES", ownerTarget), false);
  });
});
