import { describe, expect, it } from "vitest";
import { can, canOn, refusal, type ResourcePermission, type ReviewAuthor, type SubjectPermission, type Viewer } from "@src/auth/permissions";

const visitor = null;
const user = { id: 1, role: "user", bannedAt: null } as const;
const otherUser = { id: 2, role: "user", bannedAt: null } as const;
const bannedUser = { id: 3, role: "user", bannedAt: new Date("2026-01-01T00:00:00Z") } as const;
const admin = { id: 4, role: "admin", bannedAt: null } as const;
const otherAdmin = { id: 5, role: "admin", bannedAt: null } as const;

type Cases = Record<string, readonly [Viewer, unknown]>;

// For each permission, the cases in which it is granted. Every other case is refused.
function decide<C extends Cases>(cases: C, permissions: readonly ResourcePermission[]) {
	return Object.fromEntries(
		permissions.map((permission) => [
			permission,
			Object.keys(cases).filter((name) => canOn(cases[name]![0], permission, cases[name]![1] as never)),
		]),
	);
}

function author(id: number, { isPrivate = false, isFollowedByViewer = false } = {}): ReviewAuthor {
	return { id, isPrivate, isFollowedByViewer };
}

function review(authorId: number, isListed: boolean, by: Partial<ReviewAuthor> = {}) {
	return { authorId, isListed, author: author(authorId, by) };
}

describe("permissions", () => {
	it("on users", () => {
		const cases = {
			"visitor on a user": [visitor, otherUser],
			"visitor on a banned user": [visitor, bannedUser],
			"user on themselves": [user, user],
			"user on another user": [user, otherUser],
			"user on a banned user": [user, bannedUser],
			"admin on themselves": [admin, admin],
			"admin on a user": [admin, otherUser],
			"admin on a banned user": [admin, bannedUser],
			"admin on another admin": [admin, otherAdmin],
		} as const;
		const granted = {
			"user:view-profile": [
				"visitor on a user",
				"user on themselves",
				"user on another user",
				"admin on themselves",
				"admin on a user",
				"admin on a banned user",
				"admin on another admin",
			],
			// Only the author sees the reviews that are not public on their Profile.
			"user:view-hidden-reviews": ["user on themselves", "admin on themselves"],
			"user:view-follow-requests": ["user on themselves", "admin on themselves"],
			"user:follow": ["user on another user", "admin on a user", "admin on another admin"],
			"user:unfollow": ["user on another user", "user on a banned user", "admin on a user", "admin on a banned user", "admin on another admin"],
			// The user is the one who asked to follow the subject.
			"user:approve-follow-request": ["user on another user", "admin on a user", "admin on another admin"],
			"user:remove-follower": ["user on another user", "user on a banned user", "admin on a user", "admin on a banned user", "admin on another admin"],
			"user:edit-settings": ["user on themselves", "admin on themselves", "admin on a user", "admin on a banned user", "admin on another admin"],
			// Only the User sees their coordinates, not even an Admin.
			"user:edit-location": ["user on themselves", "admin on themselves"],
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

	it("on the reviews of a user", () => {
		const cases = {
			"visitor on a public user": [visitor, author(otherUser.id)],
			"visitor on a private user": [visitor, author(otherUser.id, { isPrivate: true })],
			"user on a public user": [user, author(otherUser.id)],
			"user on a private user": [user, author(otherUser.id, { isPrivate: true })],
			"follower on a private user": [user, author(otherUser.id, { isPrivate: true, isFollowedByViewer: true })],
			"private user on themselves": [user, author(user.id, { isPrivate: true })],
			"admin on a private user": [admin, author(otherUser.id, { isPrivate: true })],
		} as const;
		const granted = {
			"user:view-reviews": [
				"visitor on a public user",
				"user on a public user",
				"follower on a private user",
				"private user on themselves",
				"admin on a private user",
			],
		} satisfies Record<string, (keyof typeof cases)[]>;

		expect(decide(cases, Object.keys(granted) as ResourcePermission[])).toEqual(granted);
	});

	it("on reviews", () => {
		const cases = {
			"visitor on a listed review": [visitor, review(otherUser.id, true)],
			"visitor on a listed review of a private author": [visitor, review(otherUser.id, true, { isPrivate: true })],
			"user on a listed review of another": [user, review(otherUser.id, true)],
			"user on a hidden review of another": [user, review(otherUser.id, false)],
			"user on a listed review of a private author": [user, review(otherUser.id, true, { isPrivate: true })],
			"follower on a listed review of a private author": [user, review(otherUser.id, true, { isPrivate: true, isFollowedByViewer: true })],
			"author on their listed review": [user, review(user.id, true)],
			"author on their hidden review": [user, review(user.id, false)],
			"admin on a listed review": [admin, review(otherUser.id, true)],
			"admin on a hidden review": [admin, review(otherUser.id, false)],
			"admin on a listed review of a private author": [admin, review(otherUser.id, true, { isPrivate: true })],
		} as const;
		const granted = {
			"review:view": [
				"visitor on a listed review",
				"user on a listed review of another",
				"follower on a listed review of a private author",
				"author on their listed review",
				"author on their hidden review",
				"admin on a listed review",
				"admin on a hidden review",
				"admin on a listed review of a private author",
			],
			"review:edit": ["author on their listed review", "author on their hidden review"],
			"review:delete": [
				"author on their listed review",
				"author on their hidden review",
				"admin on a listed review",
				"admin on a hidden review",
				"admin on a listed review of a private author",
			],
			// An admin who may see a review only to moderate it may not like it.
			"review:like": ["user on a listed review of another", "follower on a listed review of a private author", "admin on a listed review"],
			"review:unlike": [
				"user on a listed review of another",
				"user on a hidden review of another",
				"user on a listed review of a private author",
				"follower on a listed review of a private author",
				"admin on a listed review",
				"admin on a hidden review",
				"admin on a listed review of a private author",
			],
		} satisfies Record<string, (keyof typeof cases)[]>;

		expect(decide(cases, Object.keys(granted) as ResourcePermission[])).toEqual(granted);
	});

	it("on restaurants", () => {
		const cases = {
			"visitor on an approved restaurant": [visitor, { status: "approved", suggestedBy: otherUser.id }],
			"visitor on a pending suggestion": [visitor, { status: "pending", suggestedBy: otherUser.id }],
			"visitor on a pending restaurant without a suggester": [visitor, { status: "pending", suggestedBy: null }],
			"user on an approved restaurant": [user, { status: "approved", suggestedBy: otherUser.id }],
			"user on their own pending suggestion": [user, { status: "pending", suggestedBy: user.id }],
			"user on a pending suggestion of another": [user, { status: "pending", suggestedBy: otherUser.id }],
			"user on a rejected suggestion of another": [user, { status: "rejected", suggestedBy: otherUser.id }],
			"admin on a pending suggestion": [admin, { status: "pending", suggestedBy: otherUser.id }],
		} as const;
		const granted = {
			"restaurant:view": ["visitor on an approved restaurant", "user on an approved restaurant", "user on their own pending suggestion", "admin on a pending suggestion"],
			"restaurant:review": ["user on an approved restaurant"],
			"restaurant:collect": ["user on an approved restaurant"],
			"restaurant:moderate": ["admin on a pending suggestion"],
		} satisfies Record<string, (keyof typeof cases)[]>;

		expect(decide(cases, Object.keys(granted) as ResourcePermission[])).toEqual(granted);
	});

	it("on no resource, which a Visitor never has", () => {
		const permissions = ["restaurant:suggest", "admin-console:view", "city-search:start", "city-list:update"] as const satisfies SubjectPermission[];
		const grantedTo = (viewer: Viewer) => permissions.filter((permission) => can(viewer, permission));

		expect({ visitor: grantedTo(visitor), user: grantedTo(user), admin: grantedTo(admin) }).toEqual({
			visitor: [],
			user: ["restaurant:suggest"],
			admin: [...permissions],
		});
	});

	it("tell a user that what they may not see does not exist, and forbid only what they can see", () => {
		const hidden = review(otherUser.id, false);
		const ofPrivateAuthor = review(otherUser.id, true, { isPrivate: true });
		const pendingOfAnother = { status: "pending", suggestedBy: otherUser.id } as const;

		expect(refusal(user, "review:like", undefined)).toBe("not-found");
		expect(refusal(user, "review:edit", hidden)).toBe("not-found");
		expect(refusal(user, "review:like", ofPrivateAuthor)).toBe("not-found");
		expect(refusal(visitor, "review:like", ofPrivateAuthor)).toBe("not-found");
		expect(refusal(user, "restaurant:collect", pendingOfAnother)).toBe("not-found");
		expect(refusal(user, "review:edit", { ...hidden, isListed: true })).toBe("forbidden");
		expect(refusal(visitor, "review:like", review(otherUser.id, true))).toBe("forbidden");
		expect(refusal(user, "restaurant:review", { ...pendingOfAnother, suggestedBy: user.id })).toBe("forbidden");
	});
});
