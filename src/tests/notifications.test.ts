import { describe, expect, it } from "vitest";
import { server } from "@src/actions/index";
import type { SessionWithUser } from "@src/auth/session";
import type { Database } from "@src/db";
import type { Notification } from "@src/db/queries/notifications";
import { actionContext, form } from "@src/tests/actions";
import { createTestDatabase, insertRestaurant, insertReview, insertUser, signIn, newestUnreadId } from "@src/tests/database";

function summary(notification: Notification) {
	const read = notification.isRead ? " (read)" : "";
	switch (notification.kind) {
		case "follow":
			return `${notification.actor.username} followed${read}`;
		case "like":
			return `${notification.actor.username} liked ${notification.review.restaurant.name}${read}`;
		case "suggestion-approved":
		case "suggestion-rejected":
			return `${notification.kind} ${notification.restaurant.name}${read}`;
	}
}

async function inbox(db: Database, userId: number) {
	const page = await db.queries.notifications.list(userId, { limit: 25, cursor: undefined });
	return page.items.map(summary);
}

async function unreadCount(db: Database, userId: number) {
	return (await signIn(db, userId)).user.unreadNotificationCount;
}

function follow(db: Database, session: SessionWithUser, username: string) {
	return server.profile.follow.call(actionContext(db, session), form({ username }));
}

function like(db: Database, session: SessionWithUser, reviewId: number) {
	return server.reviews.like.call(actionContext(db, session), form({ reviewId }));
}

function decide(db: Database, session: SessionWithUser, restaurantId: number, decision: "approve" | "reject") {
	const action = decision === "approve" ? server.admin.approveRestaurant : server.admin.rejectRestaurant;
	return action.call(actionContext(db, session), form({ restaurantId }));
}

function markAllRead(db: Database, session: SessionWithUser, upToId: number) {
	return server.notifications.markAllRead.call(actionContext(db, session), form({ upToId }));
}

describe("follow notifications", () => {
	it("tell a user once who follows them, and are taken back on unfollow", async () => {
		const { client, db } = createTestDatabase("notify-follow");
		const ada = insertUser(client, "ada");
		const bob = insertUser(client, "bob");
		const adaSession = await signIn(db, ada.id);

		await follow(db, adaSession, "bob");
		await follow(db, adaSession, "bob");

		expect(await inbox(db, bob.id)).toEqual(["ada followed"]);
		expect(await inbox(db, ada.id)).toEqual([]);

		await server.profile.unfollow.call(actionContext(db, adaSession), form({ username: "bob" }));

		expect(await inbox(db, bob.id)).toEqual([]);
	});
});

describe("like notifications", () => {
	it("tell the author once who likes their review, and are taken back on unlike", async () => {
		const { client, db } = createTestDatabase("notify-like");
		const ada = insertUser(client, "ada");
		const bob = insertUser(client, "bob");
		const review = insertReview(client, bob.id, insertRestaurant(client, "Bosporus Grill", { status: "approved" }).id, 8);
		const adaSession = await signIn(db, ada.id);

		await like(db, adaSession, review.id);
		await like(db, adaSession, review.id);

		expect(await inbox(db, bob.id)).toEqual(["ada liked Bosporus Grill"]);

		await server.reviews.unlike.call(actionContext(db, adaSession), form({ reviewId: review.id }));

		expect(await inbox(db, bob.id)).toEqual([]);
	});

	it("go away with the review", async () => {
		const { client, db } = createTestDatabase("notify-like-deleted-review");
		const ada = insertUser(client, "ada");
		const bob = insertUser(client, "bob");
		const review = insertReview(client, bob.id, insertRestaurant(client, "Bosporus Grill", { status: "approved" }).id, 8);
		await like(db, await signIn(db, ada.id), review.id);

		await server.reviews.delete.call(actionContext(db, await signIn(db, bob.id)), form({ reviewId: review.id }));

		expect(await inbox(db, bob.id)).toEqual([]);
	});
});

describe("suggestion notifications", () => {
	it("tell the suggester the decision, and a new decision replaces the earlier one as unread", async () => {
		const { client, db } = createTestDatabase("notify-decision");
		const admin = insertUser(client, "root_admin", "admin");
		const ada = insertUser(client, "ada");
		const grill = insertRestaurant(client, "Bosporus Grill", { suggestedBy: ada.id });
		const adminSession = await signIn(db, admin.id);

		await decide(db, adminSession, grill.id, "approve");
		const approved = await newestUnreadId(db, ada.id);
		await markAllRead(db, await signIn(db, ada.id), approved!);

		expect(await inbox(db, ada.id)).toEqual(["suggestion-approved Bosporus Grill (read)"]);

		await decide(db, adminSession, grill.id, "reject");

		expect(await inbox(db, ada.id)).toEqual(["suggestion-rejected Bosporus Grill"]);
		expect(await newestUnreadId(db, ada.id)).toBeGreaterThan(approved!);
	});

	it("do not tell the suggester again when the decision does not change the status", async () => {
		const { client, db } = createTestDatabase("notify-decision-unchanged");
		const admin = insertUser(client, "root_admin", "admin");
		const ada = insertUser(client, "ada");
		const grill = insertRestaurant(client, "Bosporus Grill", { suggestedBy: ada.id });
		const adminSession = await signIn(db, admin.id);
		await decide(db, adminSession, grill.id, "approve");
		await markAllRead(db, await signIn(db, ada.id), (await newestUnreadId(db, ada.id))!);

		expect((await decide(db, adminSession, grill.id, "approve")).error).toBeUndefined();

		expect(await inbox(db, ada.id)).toEqual(["suggestion-approved Bosporus Grill (read)"]);
	});

	it("do not tell an admin about their own decision, and take back the decision of another admin", async () => {
		const { client, db } = createTestDatabase("notify-decision-own");
		const ada = insertUser(client, "ada", "admin");
		const bob = insertUser(client, "bob", "admin");
		const grill = insertRestaurant(client, "Bosporus Grill", { suggestedBy: ada.id });
		await decide(db, await signIn(db, bob.id), grill.id, "reject");

		expect(await inbox(db, ada.id)).toEqual(["suggestion-rejected Bosporus Grill"]);

		await decide(db, await signIn(db, ada.id), grill.id, "approve");

		expect(await inbox(db, ada.id)).toEqual([]);
	});

	it("tell no one about a restaurant that no user suggested", async () => {
		const { client, db } = createTestDatabase("notify-decision-seeded");
		const admin = insertUser(client, "root_admin", "admin");
		const grill = insertRestaurant(client, "Bosporus Grill");

		expect((await decide(db, await signIn(db, admin.id), grill.id, "approve")).error).toBeUndefined();

		expect(client.query.notifications.findMany().sync()).toEqual([]);
	});
});

describe("notification preferences", () => {
	it("stop new notifications of a kind and keep the existing ones", async () => {
		const { client, db } = createTestDatabase("notify-preferences");
		const ada = insertUser(client, "ada");
		const bob = insertUser(client, "bob");
		const cleo = insertUser(client, "cleo");
		await follow(db, await signIn(db, ada.id), "bob");

		const result = await server.updateNotifications.call(
			actionContext(db, await signIn(db, bob.id)),
			form({ currentUsername: "bob", likeNotifications: "on", suggestionNotifications: "on" }),
		);
		await follow(db, await signIn(db, cleo.id), "bob");

		expect(result.error).toBeUndefined();
		expect(await db.queries.users.findByUsername("bob")).toMatchObject({
			followNotifications: false,
			likeNotifications: true,
			suggestionNotifications: true,
		});
		expect(await inbox(db, bob.id)).toEqual(["ada followed"]);
	});

	it("are not worked around by following again while already following", async () => {
		const { client, db } = createTestDatabase("notify-preferences-repeat");
		const ada = insertUser(client, "ada");
		const bob = insertUser(client, "bob");
		const adaSession = await signIn(db, ada.id);
		const bobSession = await signIn(db, bob.id);
		const preferences = (fields: Record<string, string>) =>
			server.updateNotifications.call(actionContext(db, bobSession), form({ currentUsername: "bob", ...fields }));

		await preferences({});
		await follow(db, adaSession, "bob");
		await preferences({ followNotifications: "on" });
		await follow(db, adaSession, "bob");

		expect(await inbox(db, bob.id)).toEqual([]);
	});

	it("can only be changed by the user or an admin", async () => {
		const { client, db } = createTestDatabase("notify-preferences-forbidden");
		const ada = insertUser(client, "ada");
		insertUser(client, "bob");
		const fields = { currentUsername: "bob", likeNotifications: "on", suggestionNotifications: "on" };

		const result = await server.updateNotifications.call(actionContext(db, await signIn(db, ada.id)), form(fields));

		expect(result.error?.code).toBe("FORBIDDEN");
		expect((await db.queries.users.findByUsername("bob"))?.followNotifications).toBe(true);
	});
});

describe("notifications of a banned user", () => {
	it("are hidden and not counted while the ban lasts", async () => {
		const { client, db } = createTestDatabase("notify-banned-actor");
		const admin = insertUser(client, "root_admin", "admin");
		const ada = insertUser(client, "ada");
		const bob = insertUser(client, "bob");
		const cleo = insertUser(client, "cleo");
		await follow(db, await signIn(db, ada.id), "bob");
		await follow(db, await signIn(db, cleo.id), "bob");

		await db.mutations.users.ban(admin.id, ada.username);

		expect(await inbox(db, bob.id)).toEqual(["cleo followed"]);
		expect(await unreadCount(db, bob.id)).toBe(1);

		await db.mutations.users.unban(admin.id, ada.username);

		expect(await inbox(db, bob.id)).toEqual(["cleo followed", "ada followed"]);
		expect(await unreadCount(db, bob.id)).toBe(2);
	});

	it("go away when that user deletes their account", async () => {
		const { client, db } = createTestDatabase("notify-deleted-actor");
		const ada = insertUser(client, "ada");
		const bob = insertUser(client, "bob");
		await follow(db, await signIn(db, ada.id), "bob");

		await db.mutations.users.delete(ada.id, ada.username);

		expect(await inbox(db, bob.id)).toEqual([]);
	});
});

describe("markAllRead action", () => {
	it("marks the notifications up to the newest the user saw, and none that were hidden", async () => {
		const { client, db } = createTestDatabase("notify-mark-read");
		const admin = insertUser(client, "root_admin", "admin");
		const ada = insertUser(client, "ada");
		const bob = insertUser(client, "bob");
		const cleo = insertUser(client, "cleo");
		const dan = insertUser(client, "dan");
		await follow(db, await signIn(db, dan.id), "bob");
		await db.mutations.users.ban(admin.id, dan.username);
		await follow(db, await signIn(db, ada.id), "bob");
		const bobSession = await signIn(db, bob.id);
		const seen = await newestUnreadId(db, bob.id);
		await follow(db, await signIn(db, cleo.id), "bob");

		const result = await markAllRead(db, bobSession, seen!);
		await db.mutations.users.unban(admin.id, dan.username);

		expect(result.error).toBeUndefined();
		expect(await inbox(db, bob.id)).toEqual(["cleo followed", "ada followed (read)", "dan followed"]);
		expect(await unreadCount(db, bob.id)).toBe(2);
	});

	it("marks only the notifications of the signed-in user", async () => {
		const { client, db } = createTestDatabase("notify-mark-read-own");
		const ada = insertUser(client, "ada");
		const bob = insertUser(client, "bob");
		await follow(db, await signIn(db, ada.id), "bob");
		const newest = await newestUnreadId(db, bob.id);

		await markAllRead(db, await signIn(db, ada.id), newest!);

		expect(await inbox(db, bob.id)).toEqual(["ada followed"]);
	});

	it("requires a signed-in user", async () => {
		const { db } = createTestDatabase("notify-mark-read-anonymous");

		const result = await server.notifications.markAllRead.call(actionContext(db, null), form({ upToId: 1 }));

		expect(result.error?.code).toBe("UNAUTHORIZED");
	});
});
