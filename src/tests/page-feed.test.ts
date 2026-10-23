import { describe, expect, it } from "vitest";
import * as s from "@src/db/schema";
import FeedPage from "@src/pages/index.astro";
import YourReviewsPage from "@src/pages/reviews/index.astro";
import { renderPage, linkHref } from "@src/tests/container";
import { createTestDatabase, insertRestaurant, insertReview, insertUser, signIn } from "@src/tests/database";

const day = 24 * 60 * 60 * 1000;
const daysAgo = (days: number) => new Date(Date.UTC(2026, 9, 1) - days * day);

function reviewTimes(html: string) {
	return [...html.matchAll(/<time class="t-body-sm shrink-0 text-fg-muted" datetime="([^"]+)"/g)].map((match) => match[1]);
}

function search(href: string | undefined) {
	if (!href) throw new Error("The page has no link.");
	return new URL(href, "http://localhost").search;
}

describe("FeedPage", () => {
	it("shows the public reviews of the people the user follows, the latest first", async () => {
		const { client, db } = createTestDatabase("feed-following");
		const admin = insertUser(client, "root_admin", "admin");
		const ada = insertUser(client, "ada");
		const bob = insertUser(client, "bob");
		const cleo = insertUser(client, "cleo");
		const dan = insertUser(client, "dan");
		const grill = insertRestaurant(client, "Bosporus Grill", { status: "approved" });
		const pending = insertRestaurant(client, "Mangal Express");
		client.insert(s.followers).values([bob, cleo, dan].map((user) => ({ followerId: ada.id, followingId: user.id }))).run();
		const bobs = [insertReview(client, bob.id, grill.id, 8, daysAgo(3)), insertReview(client, bob.id, grill.id, 6, daysAgo(1))];
		insertReview(client, bob.id, pending.id, 4, daysAgo(2));
		insertReview(client, dan.id, grill.id, 2, daysAgo(2));
		insertReview(client, ada.id, grill.id, 10, daysAgo(2));
		const cleos = insertReview(client, cleo.id, grill.id, 9, daysAgo(2));
		await db.mutations.users.ban(dan.id, admin.id);

		const { html } = await renderPage(FeedPage, { db, session: await signIn(db, ada.id) }, "/");

		expect(reviewTimes(html)).toEqual([bobs[1], cleos, bobs[0]].map((review) => review!.createdAt.toISOString()));
	});

	it("shows the public reviews of everyone in the other feed", async () => {
		const { client, db } = createTestDatabase("feed-everyone");
		const ada = insertUser(client, "ada");
		const bob = insertUser(client, "bob");
		const grill = insertRestaurant(client, "Bosporus Grill", { status: "approved" });
		const reviews = [insertReview(client, ada.id, grill.id, 10, daysAgo(2)), insertReview(client, bob.id, grill.id, 4, daysAgo(1))];

		const { html } = await renderPage(FeedPage, { db, session: await signIn(db, ada.id) }, "/?feed=everyone");

		expect(reviewTimes(html)).toEqual(reviews.toReversed().map((review) => review.createdAt.toISOString()));
	});

	it("invites a user who follows no one to find people", async () => {
		const { client, db } = createTestDatabase("feed-empty");
		const ada = insertUser(client, "ada");

		const { html } = await renderPage(FeedPage, { db, session: await signIn(db, ada.id) }, "/");

		expect(html).toContain('href="/people"');
	});

	it("pages through reviews written in the same second without skipping or repeating any", async () => {
		const { client, db } = createTestDatabase("feed-pages");
		const ada = insertUser(client, "ada");
		const restaurants = Array.from({ length: 12 }, (_, i) => insertRestaurant(client, `Kebab ${i}`, { status: "approved" }));
		const reviews = restaurants.map((restaurant) => insertReview(client, ada.id, restaurant.id, 8, daysAgo(1)));
		const session = await signIn(db, ada.id);
		const names = (html: string) => [...html.matchAll(/href="\/restaurants\/(\d+)"/g)].map((match) => Number(match[1]));

		const first = await renderPage(FeedPage, { db, session }, "/?feed=everyone&rows=10");
		const second = await renderPage(FeedPage, { db, session }, `/${search(linkHref(first.html, "next"))}`);

		expect([...names(first.html), ...names(second.html)]).toEqual(reviews.toReversed().map((review) => review.restaurantId));
		expect(linkHref(second.html, "next")).toBeUndefined();
	});
});

describe("YourReviewsPage", () => {
	it("shows all reviews of the user and marks the ones that are not public", async () => {
		const { client, db } = createTestDatabase("your-reviews");
		const ada = insertUser(client, "ada");
		const bob = insertUser(client, "bob");
		const grill = insertRestaurant(client, "Bosporus Grill", { status: "approved" });
		for (const age of [4, 3, 2, 1]) {
			insertReview(client, ada.id, grill.id, 8, daysAgo(age));
		}
		insertReview(client, bob.id, grill.id, 8, daysAgo(1));

		const { html } = await renderPage(YourReviewsPage, { db, session: await signIn(db, ada.id) }, "/reviews");

		expect(reviewTimes(html)).toHaveLength(4);
		expect(html.match(/>Hidden<\/span>/g)).toHaveLength(1);
		expect(html.match(/>Edit<\/a>/g)).toHaveLength(4);
	});
});
