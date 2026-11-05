import { describe, expect, it } from "vitest";
import type { Database } from "@src/db";
import type { Notification } from "@src/db/notifications";
import NotificationsPage from "@src/pages/notifications.astro";
import { renderPage } from "@src/tests/container";
import { createTestDatabase, insertRestaurant, insertUser, signIn } from "@src/tests/database";

function summary(notification: Notification) {
	const read = notification.isRead ? " (read)" : "";
	switch (notification.kind) {
		case "follow":
			return `${notification.actor.username} followed${read}`;
		case "follow-request":
			return `${notification.actor.username} asked to follow${read}`;
		case "follow-accepted":
			return `${notification.actor.username} approved${read}`;
		case "like":
			return `${notification.actor.username} liked ${notification.review.restaurant.name}${read}`;
		case "suggestion-approved":
		case "suggestion-rejected":
			return `${notification.kind} ${notification.restaurant.name}${read}`;
		case "city-search-finished":
			return `${notification.citySearch.status} search of ${notification.citySearch.name} with ${notification.citySearch.restaurantCount}${read}`;
	}
}

// Shows the User their notifications, which marks them read.
async function inbox(db: Database, userId: number) {
	const { page } = await db.notifications.show(userId, { limit: 25, cursor: undefined });
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

		await db.restaurants.decide(admin.id, [grill.id], "approved");

		expect(await inbox(db, ada.id)).toEqual(["suggestion-approved Bosporus Grill"]);

		await db.restaurants.decide(admin.id, [grill.id], "approved");

		expect(await inbox(db, ada.id)).toEqual(["suggestion-approved Bosporus Grill (read)"]);

		await db.restaurants.decide(admin.id, [grill.id], "rejected");

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

		expect(await unreadCount(db, bob.id)).toBe(1);
		expect(await inbox(db, bob.id)).toEqual(["cleo followed"]);

		await db.users.unban(admin.id, ada.username);

		expect(await unreadCount(db, bob.id)).toBe(1);
		expect(await inbox(db, bob.id)).toEqual(["cleo followed (read)", "ada followed"]);
	});

	it("are marked read once shown, leaving those on other pages, newer ones and hidden ones unread", async () => {
		const { client, db } = createTestDatabase();
		const admin = insertUser(client, "root_admin", "admin");
		const ada = insertUser(client, "ada");
		const bob = insertUser(client, "bob");
		const cleo = insertUser(client, "cleo");
		const dan = insertUser(client, "dan");
		const eve = insertUser(client, "eve");
		await db.follows.follow(dan.id, "bob");
		await db.users.ban(admin.id, dan.username);
		await db.follows.follow(ada.id, "bob");
		await db.follows.follow(cleo.id, "bob");

		const firstPage = await db.notifications.show(bob.id, { limit: 1, cursor: undefined });
		await db.follows.follow(eve.id, "bob");
		await db.users.unban(admin.id, dan.username);

		expect({ shown: firstPage.page.items.map(summary), unreadCount: firstPage.unreadCount }).toEqual({ shown: ["cleo followed"], unreadCount: 1 });
		expect(await inbox(db, bob.id)).toEqual(["eve followed", "cleo followed (read)", "ada followed", "dan followed"]);
	});

	it("are marked read when the User opens their list, and not when the browser loads it in advance", async () => {
		const { client, db } = createTestDatabase();
		const ada = insertUser(client, "ada");
		const bob = insertUser(client, "bob");
		await db.follows.follow(ada.id, "bob");

		const speculation = await renderPage(NotificationsPage, { db, session: await signIn(db, bob.id) }, "/notifications", {}, { "Sec-Purpose": "prefetch;prerender" });

		expect(speculation.response.status).toBe(503);
		expect(await unreadCount(db, bob.id)).toBe(1);

		const { response, html } = await renderPage(NotificationsPage, { db, session: await signIn(db, bob.id) }, "/notifications");

		expect(response.status).toBe(200);
		expect(html).toContain('<span class="sr-only">New</span>');
		expect(html).not.toContain(", 1 unread");
		expect(await unreadCount(db, bob.id)).toBe(0);
	});
});
