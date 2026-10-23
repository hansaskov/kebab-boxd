import { describe, expect, it } from "vitest";
import { can, type UserPermission } from "@src/auth/permissions";

const ada = { id: 1, role: "user", bannedAt: null } as const;
const bob = { id: 2, role: "user", bannedAt: null } as const;
const bannedBob = { ...bob, bannedAt: new Date("2026-01-01T00:00:00Z") };
const admin = { id: 3, role: "admin", bannedAt: null } as const;
const otherAdmin = { id: 4, role: "admin", bannedAt: null } as const;

const userPermissions: UserPermission[] = ["user:edit-settings", "user:manage-sessions"];

describe("can", () => {
	it.each(userPermissions)("lets a user %s on their own account", (permission) => {
		expect(can(ada, permission, ada)).toBe(true);
	});

	it.each(userPermissions)("does not let a user %s on another account", (permission) => {
		expect(can(ada, permission, bob)).toBe(false);
	});

	it.each(userPermissions)("lets an admin %s on any account", (permission) => {
		expect(can(admin, permission, bob)).toBe(true);
	});

	it("lets only admins open the admin console", () => {
		expect(can(admin, "admin-console:view")).toBe(true);
		expect(can(ada, "admin-console:view")).toBe(false);
	});

	it("lets only admins ban users", () => {
		expect(can(admin, "user:ban", bob)).toBe(true);
		expect(can(ada, "user:ban", bob)).toBe(false);
		expect(can(ada, "user:ban", ada)).toBe(false);
	});

	it("does not let an admin ban another admin or themselves", () => {
		expect(can(admin, "user:ban", otherAdmin)).toBe(false);
		expect(can(admin, "user:ban", admin)).toBe(false);
	});

	it("lets only admins change the role of another user, admin or not", () => {
		expect(can(admin, "user:change-role", bob)).toBe(true);
		expect(can(admin, "user:change-role", otherAdmin)).toBe(true);
		expect(can(ada, "user:change-role", bob)).toBe(false);
		expect(can(ada, "user:change-role", ada)).toBe(false);
	});

	it("does not let an admin change their own role", () => {
		expect(can(admin, "user:change-role", admin)).toBe(false);
	});

	it("does not let an admin change the role of a banned user", () => {
		expect(can(admin, "user:change-role", bannedBob)).toBe(false);
	});

	it("lets an admin lift the ban of a banned user", () => {
		expect(can(admin, "user:ban", bannedBob)).toBe(true);
	});

	it("lets a user download only their own data, so not even an admin can download it", () => {
		expect(can(ada, "user:export-data", ada)).toBe(true);
		expect(can(admin, "user:export-data", admin)).toBe(true);
		expect(can(ada, "user:export-data", bob)).toBe(false);
		expect(can(admin, "user:export-data", bob)).toBe(false);
	});

	it("lets a user delete only their own account", () => {
		expect(can(ada, "user:delete-account", ada)).toBe(true);
		expect(can(ada, "user:delete-account", bob)).toBe(false);
	});

	it("does not let an admin delete any account, so an admin always remains", () => {
		expect(can(admin, "user:delete-account", admin)).toBe(false);
		expect(can(admin, "user:delete-account", bob)).toBe(false);
	});
});
