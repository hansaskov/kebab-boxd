import { describe, expect, it } from "vitest";
import FeedPage from "@src/pages/index.astro";
import NotificationsPage from "@src/pages/notifications.astro";
import { decode, renderPage } from "@src/tests/container";
import { createTestDatabase, insertRestaurant, insertReview, insertUser, signIn } from "@src/tests/database";

function listedNotifications(html: string) {
	const list = html.match(/<ol[^>]*>([\s\S]*?)<\/ol>/)?.[1] ?? "";
	return [...list.matchAll(/<a[^>]*href="([^"]+)"[^>]*>[\s\S]*?<p[^>]*>([\s\S]*?)<\/p>[\s\S]*?<\/a>/g)].map((match) => ({
		href: match[1],
		text: decode(match[2]!.replace(/<[^>]+>/g, "").replace(/\s+/g, " ").trim()),
		isUnread: match[0].includes(">Unread<"),
	}));
}

function markAllReadUpToId(html: string) {
	const value = html.match(/name="upToId" value="(\d+)"/)?.[1];
	return value === undefined ? undefined : Number(value);
}

describe("NotificationsPage", () => {
	it("lists every kind of notification, the newest first, each leading to what it is about", async () => {
		const { client, db } = createTestDatabase("notifications-page-kinds");
		const admin = insertUser(client, "root_admin", "admin");
		const ada = insertUser(client, "ada");
		const bob = insertUser(client, "bob");
		const review = insertReview(client, ada.id, insertRestaurant(client, "Bosporus Grill", { status: "approved" }).id, 8);
		const suggested = insertRestaurant(client, "Mangal Express", { suggestedBy: ada.id });
		const refused = insertRestaurant(client, "Saray Döner", { suggestedBy: ada.id });
		await db.mutations.follows.follow(bob.id, ada.id);
		await db.mutations.reviews.like(bob.id, review.id);
		await db.mutations.restaurants.setStatus(admin.id, suggested.id, "approved");
		await db.mutations.restaurants.setStatus(admin.id, refused.id, "rejected");

		const { html } = await renderPage(NotificationsPage, { db, session: await signIn(db, ada.id) }, "/notifications");

		expect(listedNotifications(html)).toEqual([
			{ href: `/restaurants/${refused.id}`, text: "An admin rejected Saray Döner.", isUnread: true },
			{ href: `/restaurants/${suggested.id}`, text: "An admin approved Mangal Express.", isUnread: true },
			{ href: `/reviews/${review.id}`, text: "bob user liked your review of Bosporus Grill.", isUnread: true },
			{ href: "/bob/profile", text: "bob user followed you.", isUnread: true },
		]);
		expect(markAllReadUpToId(html)).toBe(await db.queries.notifications.findNewestUnreadId(ada.id));
	});

	it("shows which notifications are read, and offers to mark the rest", async () => {
		const { client, db } = createTestDatabase("notifications-page-read");
		const ada = insertUser(client, "ada");
		const bob = insertUser(client, "bob");
		const cleo = insertUser(client, "cleo");
		await db.mutations.follows.follow(bob.id, ada.id);
		await db.mutations.notifications.markAllRead(ada.id, (await db.queries.notifications.findNewestUnreadId(ada.id))!);
		await db.mutations.follows.follow(cleo.id, ada.id);
		const session = await signIn(db, ada.id);

		const { html } = await renderPage(NotificationsPage, { db, session }, "/notifications");

		expect(listedNotifications(html).map((notification) => notification.isUnread)).toEqual([true, false]);
		expect(markAllReadUpToId(html)).toBeDefined();

		await db.mutations.notifications.markAllRead(ada.id, markAllReadUpToId(html)!);
		const after = await renderPage(NotificationsPage, { db, session }, "/notifications");

		expect(listedNotifications(after.html).map((notification) => notification.isUnread)).toEqual([false, false]);
		expect(markAllReadUpToId(after.html)).toBeUndefined();
	});

	it("says so when there are no notifications", async () => {
		const { client, db } = createTestDatabase("notifications-page-empty");
		const ada = insertUser(client, "ada");

		const { html } = await renderPage(NotificationsPage, { db, session: await signIn(db, ada.id) }, "/notifications");

		expect(html).toContain("You have no notifications.");
	});

	it("sends a visitor who is not signed in to the sign-in page", async () => {
		const { db } = createTestDatabase("notifications-page-anonymous");

		const { response } = await renderPage(NotificationsPage, { db, session: null }, "/notifications");

		expect(response.status).toBe(302);
		expect(response.headers.get("Location")).toBe("/login");
	});
});

describe("Header", () => {
	it("shows the number of unread notifications on every page", async () => {
		const { client, db } = createTestDatabase("notifications-header");
		const ada = insertUser(client, "ada");
		const bob = insertUser(client, "bob");
		const cleo = insertUser(client, "cleo");

		const before = await renderPage(FeedPage, { db, session: await signIn(db, ada.id) }, "/");

		expect(before.html).toContain('href="/notifications"');
		expect(before.html).not.toContain("unread</span>");

		await db.mutations.follows.follow(bob.id, ada.id);
		await db.mutations.follows.follow(cleo.id, ada.id);
		const after = await renderPage(FeedPage, { db, session: await signIn(db, ada.id) }, "/");

		expect(after.html).toContain("Notifications, 2 unread");
	});
});
