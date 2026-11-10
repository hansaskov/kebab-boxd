import { describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { isProblem } from "@src/db/problem";
import { defaultMapZoom } from "@src/data/map";
import * as s from "@src/db/schema";
import { exploreHref } from "@src/hrefs";
import ExplorePage from "@src/pages/explore.astro";
import FeedPage from "@src/pages/feed.astro";
import NotificationsPage from "@src/pages/notifications.astro";
import ProfilePage from "@src/pages/[username]/profile.astro";
import RestaurantPage from "@src/pages/restaurants/[id].astro";
import ReviewPage from "@src/pages/reviews/[id]/index.astro";
import NewReviewPage from "@src/pages/reviews/new.astro";
import SearchPage from "@src/pages/search.astro";
import SettingsPage from "@src/pages/[username]/settings/index.astro";
import type { Database } from "@src/db";
import { dialogIn, renderPage } from "@src/tests/container";
import { createTestDatabase, insertRestaurant, insertReview, insertUser, restaurantPlace } from "@src/tests/database";

type Page = Parameters<typeof renderPage>[0];

function visit(db: Database, page: Page, path: string, params: Record<string, string> = {}) {
	return renderPage(page, { db, session: null }, path, params);
}

async function publish(db: Database, authorId: number, restaurantId: number, description: string) {
	const review = await db.reviews.create(authorId, restaurantId, { rating: 9, description }, []);
	if (isProblem(review)) throw new Error(`The review was refused: ${review.problem}.`);
	return String(review.id);
}

describe("A Visitor", () => {
	it("reads the approved Restaurants, the listed Reviews, the Profiles and the Feed of everyone", async () => {
		const { client, db } = createTestDatabase();
		const ada = insertUser(client, "ada");
		const grill = insertRestaurant(client, "Bosporus Grill", { status: "approved" });
		const id = String(grill.id);
		const reviewId = await publish(db, ada.id, grill.id, "Crisp bread");

		const pages = {
			feed: await visit(db, FeedPage, "/feed"),
			// A Visitor follows no one, so the Feed of the people they follow is the Feed of everyone.
			followedFeed: await visit(db, FeedPage, "/feed?feed=following"),
			restaurant: await visit(db, RestaurantPage, `/restaurants/${id}`, { id }),
			review: await visit(db, ReviewPage, `/reviews/${reviewId}`, { id: reviewId }),
			profile: await visit(db, ProfilePage, "/ada/profile", { username: "ada" }),
			explore: await visit(db, ExplorePage, exploreHref({ center: restaurantPlace, zoom: defaultMapZoom })),
			search: await visit(db, SearchPage, "/search?q=grill"),
		};
		const shown = Object.fromEntries(
			Object.entries(pages).map(([name, { response, html }]) => [name, [response.status, html.includes("Crisp bread") || html.includes("Bosporus Grill")]]),
		);

		expect(shown).toEqual({
			feed: [200, true],
			followedFeed: [200, true],
			restaurant: [200, true],
			review: [200, true],
			profile: [200, true],
			explore: [200, true],
			search: [200, true],
		});
		expect(pages.feed.html).not.toContain('aria-label="Feeds"');
	});

	it("does not see what only signed-in Users may see", async () => {
		const { client, db } = createTestDatabase();
		const admin = insertUser(client, "root_admin", "admin");
		const ada = insertUser(client, "ada");
		const bob = insertUser(client, "bob");
		const pending = insertRestaurant(client, "Mangal Express", { suggestedBy: ada.id });
		const hidden = String(insertReview(client, ada.id, pending.id, 4).id);
		client.update(s.users).set({ bio: "Secret sauce" }).where(eq(s.users.id, bob.id)).run();
		await db.users.ban(admin.id, bob.username);

		const restaurant = await visit(db, RestaurantPage, `/restaurants/${pending.id}`, { id: String(pending.id) });
		const review = await visit(db, ReviewPage, `/reviews/${hidden}`, { id: hidden });
		const banned = await visit(db, ProfilePage, "/bob/profile", { username: "bob" });

		expect([restaurant.response.status, review.response.status]).toEqual([404, 404]);
		expect(banned.html).toContain("This account has been suspended.");
		expect(banned.html).not.toContain("Secret sauce");
	});

	it("changes nothing, and is asked to sign in for what a User could do, then brought back", async () => {
		const { client, db } = createTestDatabase();
		const ada = insertUser(client, "ada");
		const grill = insertRestaurant(client, "Bosporus Grill", { status: "approved" });
		const id = String(grill.id);
		const reviewId = await publish(db, ada.id, grill.id, "Crisp bread");

		const restaurant = (await visit(db, RestaurantPage, `/restaurants/${id}`, { id })).html;
		const profile = (await visit(db, ProfilePage, "/ada/profile", { username: "ada" })).html;
		const others = await Promise.all([
			visit(db, FeedPage, "/feed"),
			visit(db, ReviewPage, `/reviews/${reviewId}`, { id: reviewId }),
			visit(db, SearchPage, "/search?q=ada"),
		]);

		expect([restaurant, profile, ...others.map((page) => page.html)].some((html) => html.includes('method="post"'))).toBe(false);
		// Each opens a dialog on the page that asks the Visitor to log in. Writing a review leads to the form for it once
		// they are signed in. Saving the restaurant and following lead back to the page.
		const asks = (html: string, reason: string) => [html.includes(`commandfor="login-${reason}" command="show-modal"`), dialogIn(html, `login-${reason}`)];
		const [writes, writeDialog] = asks(restaurant, "write-review");
		const [saves, saveDialog] = asks(restaurant, "save-restaurant");
		const [follows, followDialog] = asks(profile, "follow");
		expect([writes, saves, follows]).toEqual([true, true, true]);
		expect(writeDialog).toContain(`href="/api/google?next=${encodeURIComponent(`/reviews/new?restaurant=${id}`)}"`);
		expect(saveDialog).toContain(`href="/api/google?next=${encodeURIComponent(`/restaurants/${id}`)}"`);
		expect(followDialog).toContain(`href="/api/google?next=${encodeURIComponent("/ada/profile")}"`);
		expect([writeDialog, saveDialog, followDialog].some((dialog) => /^<dialog\b[^>]*\sopen\b/.test(String(dialog)))).toBe(false);
	});

	it("is sent to sign in by the pages that are personal or change something, and brought back to them", async () => {
		const { client, db } = createTestDatabase();
		insertUser(client, "ada");
		const grill = insertRestaurant(client, "Bosporus Grill", { status: "approved" });

		const locations = await Promise.all(
			[
				visit(db, NewReviewPage, `/reviews/new?restaurant=${grill.id}`),
				visit(db, NotificationsPage, "/notifications"),
				visit(db, SettingsPage, "/ada/settings", { username: "ada" }),
			].map(async (page) => (await page).response.headers.get("Location")),
		);

		expect(locations).toEqual([
			`/login?reason=write-review&next=${encodeURIComponent(`/reviews/new?restaurant=${grill.id}`)}`,
			`/login?reason=notifications&next=${encodeURIComponent("/notifications")}`,
			`/login?reason=settings&next=${encodeURIComponent("/ada/settings")}`,
		]);
	});
});
