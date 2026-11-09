import { describe, expect, it } from "vitest";
import { sessionCookieName } from "@src/auth/session";
import type { Database } from "@src/db";
import { isProblem } from "@src/db/problem";
import { visitorCacheOf, visitorPageMaxAge, visitorPageStaleSeconds } from "@src/middleware/visitor-cache";
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

const kept = { maxAge: visitorPageMaxAge, swr: visitorPageStaleSeconds };

function get(cookie?: string) {
	return new Request("http://localhost/feed", { headers: cookie ? { Cookie: cookie } : {} });
}

function page(status = 200, contentType = "text/html") {
	return new Response("<p>Kebab</p>", { status, headers: { "Content-Type": contentType } });
}

describe("the cache of the pages a Visitor reads", () => {
	it("keeps a page, and a page that is not there, for every Visitor", () => {
		expect([visitorCacheOf(get(), page()), visitorCacheOf(get(), page(404))]).toEqual([kept, kept]);
	});

	it("keeps the page of a Visitor who sends other cookies, which Cloudflare keeps apart", () => {
		expect(visitorCacheOf(get("theme=dark"), page())).toEqual(kept);
	});

	it("never keeps a page of a User, whose session cookie may come among others, and may have ended", () => {
		const cookies = [`${sessionCookieName}=abc.def`, `theme=dark; ${sessionCookieName}=abc.def`, `${sessionCookieName}=ended.session`];

		expect(cookies.map((cookie) => visitorCacheOf(get(cookie), page()))).toEqual([false, false, false]);
	});

	it("never keeps a form sent, an error, a redirect or a picture", () => {
		const post = new Request("http://localhost/feed", { method: "POST" });

		expect([
			visitorCacheOf(post, page()),
			visitorCacheOf(get(), page(500)),
			visitorCacheOf(get(), new Response(null, { status: 302, headers: { Location: "/login" } })),
			visitorCacheOf(get(), page(200, "image/webp")),
		]).toEqual([false, false, false, false]);
	});
});

describe("a page a Visitor reads", () => {
	// Cloudflare finds a kept page by its address alone. A page that changed with anything else of the request would
	// show the next Visitor what the request of the first one asked for.
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

	// Cloudflare finds a kept page by its path, not its host, so a page asked for at the workers.dev address of the
	// Worker would show that address to the Visitors of the site.
	it("names the address of the site, whatever host it was asked for at", async () => {
		const { db } = createTestDatabase();
		const site = new URL(import.meta.env.SITE);
		const at = async (origin: string) => (await renderPage(FeedPage, { db, session: null }, `${origin}/feed?feed=everyone`)).html;

		const [ownHost, otherHost] = [await at(site.origin), await at("https://web.someone.workers.dev")];

		expect(otherHost).toBe(ownHost);
		expect(ownHost).toContain(`<meta property="og:url" content="${site.origin}/feed?feed=everyone">`);
	});
});
