import { describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import * as s from "@src/db/schema";
import { allowed, createTestDatabase, firstPage, insertRestaurant, insertReview, insertUser, restaurantRow, writeReview } from "@src/tests/database";

const day = 24 * 60 * 60 * 1000;
const daysAgo = (days: number) => new Date(Date.now() - days * day);

describe("RatingAvg", () => {
	it("averages the ReviewWindow of each user first, so every user counts the same", async () => {
		const { client, db } = createTestDatabase();
		const ada = insertUser(client, "ada");
		const bob = insertUser(client, "bob");
		const grill = insertRestaurant(client, "Bosporus Grill", { status: "approved" });

		for (const rating of [2, 10, 10, 10]) await writeReview(db, ada.id, grill.id, rating);
		await writeReview(db, bob.id, grill.id, 6);

		expect(restaurantRow(client, grill.id)).toMatchObject({ ratingAvg: 8, reviewCount: 5 });
	});

	it("leaves out the reviews of a banned user until the ban is lifted", async () => {
		const { client, db } = createTestDatabase();
		const admin = insertUser(client, "root_admin", "admin");
		const ada = insertUser(client, "ada");
		const bob = insertUser(client, "bob");
		const grill = insertRestaurant(client, "Bosporus Grill", { status: "approved" });
		await writeReview(db, ada.id, grill.id, 10);
		const spam = await writeReview(db, bob.id, grill.id, 2);
		const listed = async () => allowed(await db.reviews.listByRestaurant(grill.id, ada.id, firstPage)).items.map((review) => review.id);

		await db.users.ban(admin.id, bob.username);

		expect(restaurantRow(client, grill.id)).toMatchObject({ ratingAvg: 10, reviewCount: 1 });
		expect(await listed()).not.toContain(spam);

		await db.users.unban(admin.id, bob.username);

		expect(restaurantRow(client, grill.id)).toMatchObject({ ratingAvg: 6, reviewCount: 2 });
		expect(await listed()).toContain(spam);
	});
});

describe("the Feed", () => {
	it("lists the reviews of the people the user follows that are in the ReviewWindow, at approved restaurants, by unbanned authors", async () => {
		const { client, db } = createTestDatabase();
		const admin = insertUser(client, "root_admin", "admin");
		const ada = insertUser(client, "ada");
		const bob = insertUser(client, "bob");
		const cleo = insertUser(client, "cleo");
		const dan = insertUser(client, "dan");
		const grill = insertRestaurant(client, "Bosporus Grill", { status: "approved" });
		const pending = insertRestaurant(client, "Mangal Express");
		for (const user of [bob, cleo, dan]) await db.follows.follow(ada.id, user.username);
		insertReview(client, bob.id, grill.id, 8, daysAgo(9));
		const bobs = [6, 4, 2].map((age) => insertReview(client, bob.id, grill.id, 8, daysAgo(age)));
		insertReview(client, bob.id, pending.id, 4, daysAgo(2));
		insertReview(client, dan.id, grill.id, 2, daysAgo(2));
		insertReview(client, ada.id, grill.id, 10, daysAgo(2));
		const cleos = insertReview(client, cleo.id, grill.id, 9, daysAgo(3));
		await db.users.ban(admin.id, dan.username);

		const feed = await db.reviews.listFollowed(ada.id, firstPage);

		expect(feed.items.map((review) => review.id)).toEqual([bobs[2]!.id, cleos.id, bobs[1]!.id, bobs[0]!.id]);
	});
});

describe("Likes", () => {
	it("count each user once, and only on a listed review", async () => {
		const { client, db } = createTestDatabase();
		const ada = insertUser(client, "ada");
		const bob = insertUser(client, "bob");
		const cleo = insertUser(client, "cleo");
		const grill = insertRestaurant(client, "Bosporus Grill", { status: "approved" });
		const outsideWindow = insertReview(client, bob.id, grill.id, 8, daysAgo(4));
		const review = [3, 2, 1].map((age) => insertReview(client, bob.id, grill.id, 8, daysAgo(age))).at(-1)!;
		const seenBy = async (viewerId: number) => (await db.reviews.findById(review.id, viewerId))!;

		await db.reviews.like(ada.id, review.id);
		await db.reviews.like(ada.id, review.id);
		await db.reviews.like(cleo.id, review.id);

		expect(await seenBy(ada.id)).toMatchObject({ likeCount: 2, isLikedByViewer: true });

		await db.reviews.unlike(ada.id, review.id);

		expect(await seenBy(ada.id)).toMatchObject({ likeCount: 1, isLikedByViewer: false });
		expect(await db.reviews.like(ada.id, outsideWindow.id)).toEqual({ problem: "not-found", permission: "review:like" });
	});
});

describe("restaurant lists", () => {
	it("page forward and back through equal ratings without skipping or repeating a restaurant", async () => {
		const { client, db } = createTestDatabase();
		const restaurants = Array.from({ length: 12 }, (_, i) => insertRestaurant(client, `Kebab ${i}`, { status: "approved" }));
		for (const [i, restaurant] of restaurants.entries()) {
			client.update(s.restaurants).set({ ratingAvg: i < 6 ? 7.5 : 8 + 1 / 3, reviewCount: 1 }).where(eq(s.restaurants.id, restaurant.id)).run();
		}
		const expected = [...restaurants.slice(6).toReversed(), ...restaurants.slice(0, 6).toReversed()].map((restaurant) => restaurant.id);
		const list = async (cursor: (typeof firstPage)["cursor"]) => db.restaurants.list("", "top-rated", { limit: 10, cursor });

		const first = await list(undefined);
		const second = await list(first.next);
		const back = await list(second.previous);

		expect(first.items.map((restaurant) => restaurant.id)).toEqual(expected.slice(0, 10));
		expect(second.items.map((restaurant) => restaurant.id)).toEqual(expected.slice(10));
		expect(second.next).toBeUndefined();
		expect(back.items.map((restaurant) => restaurant.id)).toEqual(expected.slice(0, 10));
	});
});
