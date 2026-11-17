import { describe, expect, it } from "vitest";
import type { Database } from "@src/db";
import type { Notification } from "@src/notifications/notifications.db";
import NotificationsPage from "@src/pages/notifications.astro";
import { renderPage } from "@src/tests/container";
import { createTestDatabase, insertUser, signIn } from "@src/tests/database";

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

async function inbox(db: Database, userId: number) {
	const { page } = await db.notifications.show(userId, { limit: 25, cursor: undefined });
	return page.items.map(summary);
}

async function unreadCount(db: Database, userId: number) {
	return (await signIn(db, userId)).user.unreadNotificationCount;
}

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
