import { describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import * as s from "@src/db/schema";
import NotificationsPage from "@src/pages/notifications.astro";
import ProfilePage from "@src/pages/[username]/profile.astro";
import RestaurantPage from "@src/pages/restaurants/[id].astro";
import ReviewPage from "@src/pages/reviews/[id]/index.astro";
import NewReviewPage from "@src/pages/reviews/new.astro";
import SettingsPage from "@src/pages/[username]/settings/index.astro";
import type { Database } from "@src/db";
import { renderPage } from "@src/tests/container";
import { createTestDatabase, insertRestaurant, insertReview, insertUser } from "@src/tests/database";

type Page = Parameters<typeof renderPage>[0];

function visit(db: Database, page: Page, path: string, params: Record<string, string> = {}) {
	return renderPage(page, { db, session: null }, path, params);
}


describe("A Visitor", () => {
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
