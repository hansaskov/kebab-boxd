import { describe, expect, it } from "vitest";
import { can, type UserPermission } from "@src/auth/permissions";

const user = { id: 1, role: "user", bannedAt: null } as const;
const otherUser = { id: 2, role: "user", bannedAt: null } as const;
const bannedUser = { id: 3, role: "user", bannedAt: new Date("2026-01-01T00:00:00Z") } as const;
const admin = { id: 4, role: "admin", bannedAt: null } as const;
const otherAdmin = { id: 5, role: "admin", bannedAt: null } as const;

const pairs = {
	"user on themselves": [user, user],
	"user on another user": [user, otherUser],
	"user on a banned user": [user, bannedUser],
	"admin on themselves": [admin, admin],
	"admin on a user": [admin, otherUser],
	"admin on a banned user": [admin, bannedUser],
	"admin on another admin": [admin, otherAdmin],
} as const;

type Pair = keyof typeof pairs;

const allowed = {
	"user:view-profile": ["user on themselves", "user on another user", "admin on themselves", "admin on a user", "admin on a banned user", "admin on another admin"],
	"user:follow": ["user on another user", "admin on a user", "admin on another admin"],
	"user:unfollow": ["user on another user", "user on a banned user", "admin on a user", "admin on a banned user", "admin on another admin"],
	"user:edit-settings": ["user on themselves", "admin on themselves", "admin on a user", "admin on a banned user", "admin on another admin"],
	"user:manage-sessions": ["user on themselves", "admin on themselves", "admin on a user", "admin on a banned user", "admin on another admin"],
	"user:export-data": ["user on themselves", "admin on themselves"],
	"user:delete-account": ["user on themselves"],
	"user:ban": ["admin on a user", "admin on a banned user"],
	"user:change-role": ["admin on a user", "admin on another admin"],
} satisfies Record<UserPermission, Pair[]>;

describe("can", () => {
	it("decides every user permission for every kind of actor and target", () => {
		const decided = Object.fromEntries(
			(Object.keys(allowed) as UserPermission[]).map((permission) => [
				permission,
				(Object.keys(pairs) as Pair[]).filter((pair) => can(pairs[pair][0], permission, pairs[pair][1])),
			]),
		);

		expect(decided).toEqual(allowed);
	});
});
