import { describe, expect, it } from "vitest";
import { canOn, refusal, type ResourcePermission } from "@src/auth/permissions";

const user = { id: 1, role: "user", bannedAt: null } as const;
const otherUser = { id: 2, role: "user", bannedAt: null } as const;
const bannedUser = { id: 3, role: "user", bannedAt: new Date("2026-01-01T00:00:00Z") } as const;
const admin = { id: 4, role: "admin", bannedAt: null } as const;
const otherAdmin = { id: 5, role: "admin", bannedAt: null } as const;

type Actor = typeof user | typeof admin;
type Cases = Record<string, readonly [Actor, unknown]>;

// For each permission, the cases in which it is granted. Every other case is refused.
function decide<C extends Cases>(cases: C, permissions: readonly ResourcePermission[]) {
	return Object.fromEntries(
		permissions.map((permission) => [
			permission,
			Object.keys(cases).filter((name) => canOn(cases[name]![0], permission, cases[name]![1] as never)),
		]),
	);
}

describe("permissions", () => {
	it("on users", () => {
		const cases = {
			"user on themselves": [user, user],
			"user on another user": [user, otherUser],
			"user on a banned user": [user, bannedUser],
			"admin on themselves": [admin, admin],
			"admin on a user": [admin, otherUser],
			"admin on a banned user": [admin, bannedUser],
			"admin on another admin": [admin, otherAdmin],
		} as const;
		const granted = {
			"user:view-profile": ["user on themselves", "user on another user", "admin on themselves", "admin on a user", "admin on a banned user", "admin on another admin"],
			// Only the author sees the reviews that are not public on their Profile.
			"user:view-hidden-reviews": ["user on themselves", "admin on themselves"],
			"user:follow": ["user on another user", "admin on a user", "admin on another admin"],
			"user:unfollow": ["user on another user", "user on a banned user", "admin on a user", "admin on a banned user", "admin on another admin"],
			"user:edit-settings": ["user on themselves", "admin on themselves", "admin on a user", "admin on a banned user", "admin on another admin"],
			"user:manage-sessions": ["user on themselves", "admin on themselves", "admin on a user", "admin on a banned user", "admin on another admin"],
			"user:export-data": ["user on themselves", "admin on themselves"],
			// An admin cannot delete their account, so an admin always remains.
			"user:delete-account": ["user on themselves"],
			// An admin cannot be banned, and a banned user cannot be given the role or lose it.
			"user:ban": ["admin on a user", "admin on a banned user"],
			"user:change-role": ["admin on a user", "admin on another admin"],
		} satisfies Record<string, (keyof typeof cases)[]>;

		expect(decide(cases, Object.keys(granted) as ResourcePermission[])).toEqual(granted);
	});

	it("on reviews", () => {
		const cases = {
			"user on a listed review of another": [user, { authorId: otherUser.id, isListed: true }],
			"user on a hidden review of another": [user, { authorId: otherUser.id, isListed: false }],
			"author on their listed review": [user, { authorId: user.id, isListed: true }],
			"author on their hidden review": [user, { authorId: user.id, isListed: false }],
			"admin on a listed review": [admin, { authorId: otherUser.id, isListed: true }],
			"admin on a hidden review": [admin, { authorId: otherUser.id, isListed: false }],
		} as const;
		const granted = {
			"review:view": ["user on a listed review of another", "author on their listed review", "author on their hidden review", "admin on a listed review", "admin on a hidden review"],
			"review:edit": ["author on their listed review", "author on their hidden review"],
			"review:delete": ["author on their listed review", "author on their hidden review", "admin on a listed review", "admin on a hidden review"],
			"review:like": ["user on a listed review of another", "admin on a listed review"],
			"review:unlike": ["user on a listed review of another", "user on a hidden review of another", "admin on a listed review", "admin on a hidden review"],
		} satisfies Record<string, (keyof typeof cases)[]>;

		expect(decide(cases, Object.keys(granted) as ResourcePermission[])).toEqual(granted);
	});

	it("on restaurants", () => {
		const cases = {
			"user on an approved restaurant": [user, { status: "approved", suggestedBy: otherUser.id }],
			"user on their own pending suggestion": [user, { status: "pending", suggestedBy: user.id }],
			"user on a pending suggestion of another": [user, { status: "pending", suggestedBy: otherUser.id }],
			"user on a rejected suggestion of another": [user, { status: "rejected", suggestedBy: otherUser.id }],
			"admin on a pending suggestion": [admin, { status: "pending", suggestedBy: otherUser.id }],
		} as const;
		const granted = {
			"restaurant:view": ["user on an approved restaurant", "user on their own pending suggestion", "admin on a pending suggestion"],
			"restaurant:review": ["user on an approved restaurant"],
			"restaurant:collect": ["user on an approved restaurant"],
			"restaurant:moderate": ["admin on a pending suggestion"],
		} satisfies Record<string, (keyof typeof cases)[]>;

		expect(decide(cases, Object.keys(granted) as ResourcePermission[])).toEqual(granted);
	});

	it("tell a user that what they may not see does not exist, and forbid only what they can see", () => {
		const hidden = { authorId: otherUser.id, isListed: false };
		const pendingOfAnother = { status: "pending", suggestedBy: otherUser.id } as const;

		expect(refusal(user, "review:like", undefined)).toBe("not-found");
		expect(refusal(user, "review:edit", hidden)).toBe("not-found");
		expect(refusal(user, "restaurant:collect", pendingOfAnother)).toBe("not-found");
		expect(refusal(user, "review:edit", { ...hidden, isListed: true })).toBe("forbidden");
		expect(refusal(user, "restaurant:review", { ...pendingOfAnother, suggestedBy: user.id })).toBe("forbidden");
	});
});
