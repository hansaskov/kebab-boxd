import { describe, expect, it } from "vitest";
import type { Database } from "@src/db";
import type { Notification } from "@src/db/notifications";
import { createTestDatabase, insertRestaurant, insertUser, newestUnreadId, signIn } from "@src/tests/database";

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
	const page = await db.notifications.list(userId, { limit: 25, cursor: undefined });
	return page.items.map(summary);
}

async function unreadCount(db: Database, userId: number) {
	return (await signIn(db, userId)).user.unreadNotificationCount;
}

const allOn = { followNotifications: true, likeNotifications: true, suggestionNotifications: true };

describe("Notifications", () => {
	it("tell a User once who follows them, and are taken back on unfollow", async () => {
		const { client, db } = createTestDatabase();
		const ada = insertUser(client, "ada");
		const bob = insertUser(client, "bob");

		await db.follows.follow(ada.id, "bob");
		await db.follows.follow(ada.id, "bob");

		expect(await inbox(db, bob.id)).toEqual(["ada followed"]);

		await db.follows.unfollow(ada.id, "bob");

		expect(await inbox(db, bob.id)).toEqual([]);
	});

	it("tell the suggester the latest decision on their suggestion, as unread", async () => {
		const { client, db } = createTestDatabase();
		const admin = insertUser(client, "root_admin", "admin");
		const ada = insertUser(client, "ada");
		const grill = insertRestaurant(client, "Bosporus Grill", { suggestedBy: ada.id });

		await db.restaurants.decide(admin.id, grill.id, "approved");
		await db.notifications.markAllRead(ada.id, (await newestUnreadId(db, ada.id))!);
		await db.restaurants.decide(admin.id, grill.id, "approved");

		expect(await inbox(db, ada.id)).toEqual(["suggestion-approved Bosporus Grill (read)"]);

		await db.restaurants.decide(admin.id, grill.id, "rejected");

		expect(await inbox(db, ada.id)).toEqual(["suggestion-rejected Bosporus Grill"]);
	});

	it("of a kind the User turned off are not sent, even when someone follows again", async () => {
		const { client, db } = createTestDatabase();
		const ada = insertUser(client, "ada");
		const bob = insertUser(client, "bob");
		const cleo = insertUser(client, "cleo");
		await db.follows.follow(cleo.id, "bob");

		await db.users.setNotificationPreferences(bob.id, "bob", { ...allOn, followNotifications: false });
		await db.follows.follow(ada.id, "bob");
		await db.users.setNotificationPreferences(bob.id, "bob", allOn);
		await db.follows.follow(ada.id, "bob");

		expect(await inbox(db, bob.id)).toEqual(["cleo followed"]);
	});

	it("from a banned User are hidden and not counted until the ban is lifted", async () => {
		const { client, db } = createTestDatabase();
		const admin = insertUser(client, "root_admin", "admin");
		const ada = insertUser(client, "ada");
		const bob = insertUser(client, "bob");
		const cleo = insertUser(client, "cleo");
		await db.follows.follow(ada.id, "bob");
		await db.follows.follow(cleo.id, "bob");

		await db.users.ban(admin.id, ada.username);

		expect(await inbox(db, bob.id)).toEqual(["cleo followed"]);
		expect(await unreadCount(db, bob.id)).toBe(1);

		await db.users.unban(admin.id, ada.username);

		expect(await inbox(db, bob.id)).toEqual(["cleo followed", "ada followed"]);
		expect(await unreadCount(db, bob.id)).toBe(2);
	});

	it("are marked read up to the newest the User saw, leaving newer and hidden ones unread", async () => {
		const { client, db } = createTestDatabase();
		const admin = insertUser(client, "root_admin", "admin");
		const ada = insertUser(client, "ada");
		const bob = insertUser(client, "bob");
		const cleo = insertUser(client, "cleo");
		const dan = insertUser(client, "dan");
		await db.follows.follow(dan.id, "bob");
		await db.users.ban(admin.id, dan.username);
		await db.follows.follow(ada.id, "bob");
		const seen = await newestUnreadId(db, bob.id);
		await db.follows.follow(cleo.id, "bob");

		await db.notifications.markAllRead(bob.id, seen!);
		await db.users.unban(admin.id, dan.username);

		expect(await inbox(db, bob.id)).toEqual(["cleo followed", "ada followed (read)", "dan followed"]);
	});
});
