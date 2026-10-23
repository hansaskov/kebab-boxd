import { describe, expect, it } from "vitest";
import * as s from "@src/db/schema";
import type { Cursor } from "@src/pagination";
import { createTestDatabase, insertRestaurant, insertReview, insertUser } from "@src/tests/database";

const day = 24 * 60 * 60 * 1000;
const daysAgo = (days: number) => new Date(Date.now() - days * day);

describe("profiles.listReviews", () => {
	it("lists only the reviews in the review window of approved restaurants, newest first", async () => {
		const { client, db } = createTestDatabase("profile-reviews-window");
		const ada = insertUser(client, "ada");
		const bob = insertUser(client, "bob");
		const grill = insertRestaurant(client, "Bosporus Grill", { status: "approved" });
		const pending = insertRestaurant(client, "Mangal Express", { status: "pending" });
		const rejected = insertRestaurant(client, "Hasir Kebab", { status: "rejected" });
		const [oldest, ...window] = [4, 3, 2, 1].map((age) => insertReview(client, ada.id, grill.id, 8, daysAgo(age)));
		insertReview(client, ada.id, pending.id, 8);
		insertReview(client, ada.id, rejected.id, 8);
		insertReview(client, bob.id, grill.id, 8);

		const page = await db.queries.profiles.listReviews(ada.id, { limit: 10, cursor: undefined });
		const totals = await db.queries.profiles.countTotals(ada.id);

		expect(page.items.map((review) => review.id)).toEqual(window.map((review) => review.id).toReversed());
		expect(page.items.map((review) => review.id)).not.toContain(oldest!.id);
		expect(totals.reviews).toBe(3);
	});

	it("orders reviews by the time they were written, not by when they were saved", async () => {
		const { client, db } = createTestDatabase("profile-reviews-order");
		const ada = insertUser(client, "ada");
		const restaurants = ["Urfa Grillhaus", "Dergah Kebab", "Kösk Kebap"].map((name) =>
			insertRestaurant(client, name, { status: "approved" }),
		);
		for (const [i, age] of [2, 0, 1].entries()) {
			insertReview(client, ada.id, restaurants[i]!.id, 8, daysAgo(age));
		}

		const first = await db.queries.profiles.listReviews(ada.id, { limit: 2, cursor: undefined });
		const second = await db.queries.profiles.listReviews(ada.id, { limit: 2, cursor: first.next });

		expect([...first.items, ...second.items].map((review) => review.restaurant)).toEqual([
			"Dergah Kebab",
			"Kösk Kebap",
			"Urfa Grillhaus",
		]);
	});
});

describe("profiles.listFavorites", () => {
	it("pages through favorites added in the same second without skipping or repeating any", async () => {
		const { client, db } = createTestDatabase("profile-favorites-ties");
		const ada = insertUser(client, "ada");
		const addedAt = new Date("2026-10-01T12:00:00Z");
		const restaurants = ["Urfa Grillhaus", "Dergah Kebab", "Kösk Kebap", "Saray Döner", "Firin Döner"].map((name) =>
			insertRestaurant(client, name, { status: "approved" }),
		);
		client
			.insert(s.favorites)
			.values(restaurants.map((restaurant) => ({ userId: ada.id, restaurantId: restaurant.id, createdAt: addedAt })))
			.run();

		const names: string[] = [];
		let cursor: Cursor | undefined;
		do {
			const page = await db.queries.profiles.listFavorites(ada.id, { limit: 2, cursor });
			names.push(...page.items.map((restaurant) => restaurant.name));
			cursor = page.next;
		} while (cursor);

		expect(names).toEqual(restaurants.map((restaurant) => restaurant.name).toReversed());
	});

	it("walks back to the same pages it walked forward through", async () => {
		const { client, db } = createTestDatabase("profile-favorites-back");
		const ada = insertUser(client, "ada");
		const restaurants = Array.from({ length: 5 }, (_, i) => insertRestaurant(client, `Kebab ${i}`, { status: "approved" }));
		client
			.insert(s.favorites)
			.values(restaurants.map((restaurant, i) => ({ userId: ada.id, restaurantId: restaurant.id, createdAt: daysAgo(i) })))
			.run();
		const list = (cursor?: Cursor) => db.queries.profiles.listFavorites(ada.id, { limit: 2, cursor });

		const first = await list();
		const second = await list(first.next);
		const third = await list(second.next);

		expect(third.items.map((restaurant) => restaurant.name)).toEqual(["Kebab 4"]);
		expect(await list(third.previous)).toEqual(second);
		expect(await list(second.previous)).toEqual(first);
	});
});
