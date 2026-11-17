import { describe, expect, it } from "vitest";
import { sessionCookieName } from "@src/auth/session";
import type { Database } from "@src/db";
import { isProblem } from "@src/db/problem";
import { visitorCacheOf } from "@src/middleware/visitor-cache";
import ExplorePage from "@src/pages/explore.astro";
import FeedPage from "@src/pages/feed.astro";
import IndexPage from "@src/pages/index.astro";
import LoginPage from "@src/pages/login.astro";
import PrivacyPage from "@src/pages/privacy.astro";
import ProfilePage from "@src/pages/[username]/profile.astro";
import RestaurantPage from "@src/pages/restaurants/[id].astro";
import ReviewPage from "@src/pages/reviews/[id]/index.astro";
import SearchPage from "@src/pages/search.astro";
import { renderPage } from "@src/tests/container";
import { createTestDatabase, insertRestaurant, insertUser } from "@src/tests/database";

function get(cookie?: string) {
	return new Request("http://localhost/feed", { headers: cookie ? { Cookie: cookie } : {} });
}

function page(status = 200, contentType = "text/html") {
	return new Response("<p>Kebab</p>", { status, headers: { "Content-Type": contentType } });
}

describe("the cache of the pages a Visitor reads", () => {
	it("never keeps a page of a User, whose session cookie may come among others, and may have ended", () => {
		const cookies = [`${sessionCookieName}=abc.def`, `theme=dark; ${sessionCookieName}=abc.def`, `${sessionCookieName}=ended.session`];

		expect(cookies.map((cookie) => visitorCacheOf(get(cookie), page()))).toEqual([false, false, false]);
	});
});

describe("a page a Visitor reads", () => {
	it("depends on its address alone, not on the other headers of the request", async () => {
		const { client, db } = createTestDatabase();
		const ada = insertUser(client, "ada");
		const grill = insertRestaurant(client, "Bosporus Grill", { status: "approved" });
		const review = await db.reviews.create(ada.id, grill.id, { rating: 9, description: "Crisp bread" }, []);
		if (isProblem(review)) throw new Error(`The review was refused: ${review.problem}.`);
		const [restaurantId, reviewId] = [String(grill.id), String(review.id)];
		const pages: [Parameters<typeof renderPage>[0], string, Record<string, string>?][] = [
			[IndexPage, "/"],
			[FeedPage, "/feed"],
			[ExplorePage, "/explore?lat=55.40123&lng=10.39876&zoom=13"],
			[SearchPage, "/search?q=grill"],
			[RestaurantPage, `/restaurants/${restaurantId}`, { id: restaurantId }],
			[ReviewPage, `/reviews/${reviewId}`, { id: reviewId }],
			[ProfilePage, "/ada/profile", { username: "ada" }],
			[LoginPage, "/login?next=%2Ffeed"],
			[PrivacyPage, "/privacy"],
		];
		const otherHeaders = {
			Referer: "https://elsewhere.example/page",
			"Accept-Language": "da-DK",
			"Sec-Purpose": "prefetch;prerender",
			"User-Agent": "Scraper/1.0",
		};
		const visit = (db: Database, [component, path, params]: (typeof pages)[number], headers: HeadersInit) =>
			renderPage(component, { db, session: null }, path, params, headers);

		for (const visited of pages) {
			const plain = await visit(db, visited, {});
			const other = await visit(db, visited, otherHeaders);

			expect([plain.response.status, other.response.status], visited[1]).toEqual([200, 200]);
			expect(other.html, visited[1]).toBe(plain.html);
		}
	});
});
