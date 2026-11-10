import { describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import * as s from "@src/db/schema";
import {
	createTestDatabase,
	firstPage,
	insertRestaurant,
	insertReview,
	insertUser,
	refreshAuthorStatsOf,
	restaurantRow,
	writeReview,
} from "@src/tests/database";

const day = 24 * 60 * 60 * 1000;
const daysAgo = (days: number) => new Date(Date.now() - days * day);

describe("RatingAvg", () => {
	it("averages the ReviewWindow of each user first, so every user counts the same", async () => {
		const { client, db } = createTestDatabase();
		const ada = insertUser(client, "ada");
		const bob = insertUser(client, "bob");
		const grill = insertRestaurant(client, "Bosporus Grill", { status: "approved" });

		// The first 2 falls out of the window of Ada, whose average is then 10.
		for (const rating of [2, 10, 10, 10]) await writeReview(db, ada.id, grill.id, rating);
		await writeReview(db, bob.id, grill.id, 6);

		expect(restaurantRow(client, grill.id)).toMatchObject({ ratingAvg: 8, reviewCount: 5 });
	});

	it("follows a review that is changed or deleted", async () => {
		const { client, db } = createTestDatabase();
		const ada = insertUser(client, "ada");
		const bob = insertUser(client, "bob");
		const grill = insertRestaurant(client, "Bosporus Grill", { status: "approved" });
		const review = await writeReview(db, ada.id, grill.id, 2);
		await writeReview(db, bob.id, grill.id, 10);

		await db.reviews.update(ada.id, review, { rating: 8, description: null, addPictures: [] });

		expect(restaurantRow(client, grill.id)).toMatchObject({ ratingAvg: 9, reviewCount: 2 });

		await db.reviews.delete(ada.id, review);

		expect(restaurantRow(client, grill.id)).toMatchObject({ ratingAvg: 10, reviewCount: 1 });
	});

	it("leaves out the reviews of a banned user until the ban is lifted", async () => {
		const { client, db } = createTestDatabase();
		const admin = insertUser(client, "root_admin", "admin");
		const ada = insertUser(client, "ada");
		const bob = insertUser(client, "bob");
		const grill = insertRestaurant(client, "Bosporus Grill", { status: "approved" });
		await writeReview(db, ada.id, grill.id, 10);
		const spam = await writeReview(db, bob.id, grill.id, 2);
		const listed = async () => (await db.reviews.listByRestaurant(grill.id, ada.id, firstPage)).items.map((review) => review.id);

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

describe("the Profile", () => {
	it("lists and counts the same Reviews: those in the ReviewWindow at approved restaurants, also while the author is banned", async () => {
		const { client, db } = createTestDatabase();
		const admin = insertUser(client, "root_admin", "admin");
		const bob = insertUser(client, "bob");
		const grill = insertRestaurant(client, "Bosporus Grill", { status: "approved" });
		const pending = insertRestaurant(client, "Mangal Express");
		insertReview(client, bob.id, grill.id, 8, daysAgo(9));
		const window = [6, 4, 2].map((age) => insertReview(client, bob.id, grill.id, 8, daysAgo(age)));
		insertReview(client, bob.id, pending.id, 4, daysAgo(1));
		refreshAuthorStatsOf(client, [bob.id]);
		await db.users.ban(admin.id, bob.username);

		const profile = await db.users.findProfile(bob.username, admin.id);
		const listed = await db.reviews.listPublicByAuthor(bob.id, admin.id, firstPage);

		expect(listed.items.map((review) => review.id)).toEqual(window.toReversed().map((review) => review.id));
		expect(profile?.publicReviewCount).toBe(listed.items.length);
	});

	it("lists and counts all Reviews of its own User, also the hidden ones", async () => {
		const { client, db } = createTestDatabase();
		const bob = insertUser(client, "bob");
		const grill = insertRestaurant(client, "Bosporus Grill", { status: "approved" });
		const pending = insertRestaurant(client, "Mangal Express");
		const written = [9, 6, 4, 2].map((age) => insertReview(client, bob.id, grill.id, 8, daysAgo(age)));
		written.push(insertReview(client, bob.id, pending.id, 4, daysAgo(1)));

		const profile = await db.users.findProfile(bob.username, bob.id);
		const listed = await db.reviews.listAllByAuthor(bob.id, bob.id, firstPage);

		expect(listed.items.map((review) => review.id)).toEqual(written.toReversed().map((review) => review.id));
		expect(listed.items.filter((review) => !review.isListed)).toHaveLength(2);
		expect(profile?.allReviewCount).toBe(listed.items.length);
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
		// 8⅓ has no short decimal form, so a cursor that rounds it would skip or repeat restaurants.
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

describe("people search", () => {
	it("orders people by their public Reviews, most first or newest first", async () => {
		const { client, db } = createTestDatabase();
		const ada = insertUser(client, "ada");
		const bob = insertUser(client, "bob");
		const cyd = insertUser(client, "cyd");
		const grill = insertRestaurant(client, "Bosporus Grill", { status: "approved" });
		const pending = insertRestaurant(client, "Pending Kebab");
		insertReview(client, ada.id, grill.id, 8, daysAgo(5));
		insertReview(client, ada.id, grill.id, 8, daysAgo(3));
		insertReview(client, bob.id, grill.id, 8, daysAgo(2));
		// Not public, so it neither counts for Cyd nor makes them the latest reviewer.
		insertReview(client, cyd.id, pending.id, 8, daysAgo(0));
		refreshAuthorStatsOf(client, [ada.id, bob.id, cyd.id]);
		const usernames = async (sort: "most-reviews" | "latest-review") =>
			(await db.users.search("", sort, ada.id, firstPage)).items.map((person) => person.username);

		expect({ mostReviews: await usernames("most-reviews"), latestReview: await usernames("latest-review") }).toEqual({
			mostReviews: ["ada", "bob", "cyd"],
			latestReview: ["bob", "ada", "cyd"],
		});
	});

	it("page forward and back through equal review counts without skipping or repeating a person", async () => {
		const { client, db } = createTestDatabase();
		const people = Array.from({ length: 12 }, (_, i) => insertUser(client, `kebab_${i}`));
		const grill = insertRestaurant(client, "Bosporus Grill", { status: "approved" });
		for (const person of people.slice(0, 6)) insertReview(client, person.id, grill.id, 8);
		refreshAuthorStatsOf(client, people.map((person) => person.id));
		const expected = [...people.slice(0, 6).toReversed(), ...people.slice(6).toReversed()].map((person) => person.id);
		const search = async (cursor: (typeof firstPage)["cursor"]) => db.users.search("kebab", "most-reviews", people[0]!.id, { limit: 10, cursor });

		const first = await search(undefined);
		const second = await search(first.next);
		const back = await search(second.previous);

		expect(first.items.map((person) => person.id)).toEqual(expected.slice(0, 10));
		expect(second.items.map((person) => person.id)).toEqual(expected.slice(10));
		expect(second.next).toBeUndefined();
		expect(back.items.map((person) => person.id)).toEqual(expected.slice(0, 10));
	});
});

describe("the review stats of a User", () => {
	const statsOf = (client: ReturnType<typeof createTestDatabase>["client"], id: number) =>
		client.query.users.findFirst({ columns: { publicReviewCount: true, latestReviewAt: true }, where: { id } }).sync();
	const secondsOf = (date: Date) => Math.floor(date.getTime() / 1000);

	it("follow the Reviews the User writes and deletes, counting only those in the ReviewWindow", async () => {
		const { client, db } = createTestDatabase();
		const ada = insertUser(client, "ada");
		const grill = insertRestaurant(client, "Bosporus Grill", { status: "approved" });
		const ids = [];
		for (const rating of [6, 8, 10, 4]) ids.push(await writeReview(db, ada.id, grill.id, rating));
		const written = statsOf(client, ada.id);
		const newest = await db.reviews.findById(ids.at(-1)!, ada.id);

		for (const id of ids.slice(1)) await db.reviews.delete(ada.id, id);
		const oneLeft = statsOf(client, ada.id);
		await db.reviews.delete(ada.id, ids[0]!);

		expect({ written, oneLeft, none: statsOf(client, ada.id) }).toEqual({
			written: { publicReviewCount: 3, latestReviewAt: secondsOf(newest!.createdAt) },
			oneLeft: { publicReviewCount: 1, latestReviewAt: expect.any(Number) },
			none: { publicReviewCount: 0, latestReviewAt: 0 },
		});
	});

	it("follow the decisions on the Restaurants the User reviewed", async () => {
		const { client, db } = createTestDatabase();
		const admin = insertUser(client, "root_admin", "admin");
		const ada = insertUser(client, "ada");
		const grill = insertRestaurant(client, "Bosporus Grill", { status: "approved" });
		await writeReview(db, ada.id, grill.id, 8);
		const approved = statsOf(client, ada.id);

		await db.restaurants.decide(admin.id, [grill.id], "rejected");
		const rejected = statsOf(client, ada.id);
		await db.restaurants.decide(admin.id, [grill.id], "approved");

		expect({ approved: approved?.publicReviewCount, rejected, again: statsOf(client, ada.id) }).toEqual({
			approved: 1,
			rejected: { publicReviewCount: 0, latestReviewAt: 0 },
			again: approved,
		});
	});

	it("keep the time of the latest Review at 0 while the Profile is private, and count its Reviews still", async () => {
		const { client, db } = createTestDatabase();
		const ada = insertUser(client, "ada");
		const grill = insertRestaurant(client, "Bosporus Grill", { status: "approved" });
		await writeReview(db, ada.id, grill.id, 8);
		const shared = statsOf(client, ada.id);

		await db.users.setPrivacy(ada.id, ada.username, true);
		const hidden = statsOf(client, ada.id);
		await db.users.setPrivacy(ada.id, ada.username, false);

		expect({ hidden, again: statsOf(client, ada.id) }).toEqual({ hidden: { publicReviewCount: 1, latestReviewAt: 0 }, again: shared });
		expect(shared?.latestReviewAt).toBeGreaterThan(0);
	});
});
