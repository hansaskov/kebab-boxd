import { describe, expect, it } from "vitest";
import { can, type UserPermission } from "@src/auth/permissions";

const ada = { id: 1, role: "user" } as const;
const bob = { id: 2, role: "user" } as const;
const admin = { id: 3, role: "admin" } as const;

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
});
