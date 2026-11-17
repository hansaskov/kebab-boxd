import { describe, expect, it } from "vitest";
import type { Database } from "@src/db";
import { isProblem } from "@src/db/problem";
import FeedPage from "@src/pages/feed.astro";
import ProfilePage from "@src/pages/[username]/profile.astro";
import RestaurantPage from "@src/pages/restaurants/[id].astro";
import ReviewPage from "@src/pages/reviews/[id]/index.astro";
import { renderPage } from "@src/tests/container";
import { createTestDatabase, firstPage, insertRestaurant, insertUser, restaurantRow, signIn } from "@src/tests/database";

async function publish(db: Database, authorId: number, restaurantId: number, description: string) {
	const review = await db.reviews.create(authorId, restaurantId, { rating: 8, description }, []);
	if (isProblem(review)) throw new Error(`The review was refused: ${review.problem}.`);
	return review.id;
}

async function sessionOf(db: Database, userId: number | null) {
	return userId === null ? null : signIn(db, userId);
}

async function whereShown(db: Database, viewerId: number | null, review: { id: number; author: string; restaurantId: number; text: string }) {
	const locals = { db, session: await sessionOf(db, viewerId) };
	const id = String(review.id);
	const restaurantId = String(review.restaurantId);
	const profile = await renderPage(ProfilePage, locals, `/${review.author}/profile`, { username: review.author });
	const page = await renderPage(ReviewPage, locals, `/reviews/${id}`, { id });
	const restaurant = await renderPage(RestaurantPage, locals, `/restaurants/${restaurantId}`, { id: restaurantId });
	const feed = await renderPage(FeedPage, locals, "/feed?feed=everyone");
	return [profile.html, page.response.status === 200 && page.html, restaurant.html, feed.html].map((html) => html !== false && html.includes(review.text));
}

async function inbox(db: Database, userId: number) {
	const { page } = await db.notifications.show(userId, firstPage);
	return page.items.map((notification) => `${notification.kind}${"actor" in notification ? ` ${notification.actor.username}` : ""}`).toSorted();
}

describe("A private Profile", () => {
	it("shares its Reviews with its User, their Followers and the Admins, and still counts them in the RatingAvg", async () => {
		const { client, db } = createTestDatabase();
		const admin = insertUser(client, "root_admin", "admin");
		const ada = insertUser(client, "ada");
		const bob = insertUser(client, "bob");
		const cleo = insertUser(client, "cleo");
		const grill = insertRestaurant(client, "Bosporus Grill", { status: "approved" });
		await db.follows.follow(ada.id, bob.username);
		const review = { id: await publish(db, bob.id, grill.id, "Garlic sauce worth the queue"), author: bob.username, restaurantId: grill.id, text: "Garlic sauce worth the queue" };
		const before = await whereShown(db, cleo.id, review);

		await db.users.setPrivacy(bob.id, bob.username, true);

		expect({
			beforeForOthers: before,
			author: await whereShown(db, bob.id, review),
			follower: await whereShown(db, ada.id, review),
			other: await whereShown(db, cleo.id, review),
			visitor: await whereShown(db, null, review),
			admin: await whereShown(db, admin.id, review),
		}).toEqual({
			beforeForOthers: [true, true, true, true],
			author: [true, true, true, true],
			follower: [true, true, true, true],
			other: [false, false, false, false],
			visitor: [false, false, false, false],
			admin: [true, true, false, false],
		});
		expect(restaurantRow(client, grill.id)).toMatchObject({ ratingAvg: 8, reviewCount: 1 });
	});

	it("lets its User remove a Follower, who then no longer sees the Reviews nor may like them", async () => {
		const { client, db } = createTestDatabase();
		const ada = insertUser(client, "ada");
		const bob = insertUser(client, "bob");
		const grill = insertRestaurant(client, "Bosporus Grill", { status: "approved" });
		await db.follows.follow(ada.id, bob.username);
		const review = await publish(db, bob.id, grill.id, "Crisp bread");
		await db.users.setPrivacy(bob.id, bob.username, true);
		await db.follows.follow(ada.id, bob.username);
		const listedToAda = async () => (await db.reviews.listEveryone(ada.id, firstPage)).items.map((item) => item.id);
		const followed = await listedToAda();

		await db.follows.removeFollower(bob.id, ada.username);

		expect({ followed, removed: await listedToAda() }).toEqual({ followed: [review], removed: [] });
		expect(await db.reviews.like(ada.id, review)).toMatchObject({ problem: "not-found" });
		expect(await inbox(db, bob.id)).toEqual([]);
	});
});
