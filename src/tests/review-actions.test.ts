import { describe, expect, it } from "vitest";
import { isInputError } from "astro:actions";
import { server } from "@src/actions/index";
import type { SessionWithUser } from "@src/auth/session";
import type { Database } from "@src/db";
import RestaurantPage from "@src/pages/restaurants/[id].astro";
import ReviewPage from "@src/pages/reviews/[id]/index.astro";
import EditReviewPage from "@src/pages/reviews/[id]/edit.astro";
import NewReviewPage from "@src/pages/reviews/new.astro";
import { actionContext, form } from "@src/tests/actions";
import { renderPage } from "@src/tests/container";
import { createTestDatabase, insertRestaurant, insertReview, insertUser, restaurantRow, signIn } from "@src/tests/database";

function writeReview(db: Database, session: SessionWithUser, restaurantId: number, rating: number, description = "") {
	return server.reviews.create.call(actionContext(db, session), form({ restaurantId, rating, description }));
}

function reviewIdOf(result: Awaited<ReturnType<typeof writeReview>>) {
	const id = result.data?.redirect.match(/^\/reviews\/(\d+)$/)?.[1];
	if (!id) throw new Error(`The review was not published: ${result.error?.message}`);
	return Number(id);
}

function renderRestaurant(db: Database, session: SessionWithUser, id: number) {
	return renderPage(RestaurantPage, { db, session }, `/restaurants/${id}`, { id: String(id) });
}

describe("reviews.create action", () => {
	it("publishes a review, shows it on the restaurant and updates the rating of the restaurant", async () => {
		const { client, db } = createTestDatabase("review-create");
		const ada = insertUser(client, "ada");
		const grill = insertRestaurant(client, "Bosporus Grill", { status: "approved" });
		const session = await signIn(db, ada.id);

		const result = await writeReview(db, session, grill.id, 9, "Crispy bread, generous sauce.");
		const id = reviewIdOf(result);

		expect(restaurantRow(client, grill.id)).toMatchObject({ ratingAvg: 9, reviewCount: 1 });
		const review = await renderPage(ReviewPage, { db, session }, `/reviews/${id}`, { id: String(id) });
		expect(review.html).toContain("Crispy bread, generous sauce.");
		expect(review.html).toContain('aria-label="4.5 out of 5 stars"');
		expect((await renderRestaurant(db, session, grill.id)).html).toContain("Crispy bread, generous sauce.");
	});

	it("does not let a user review a restaurant that is waiting for approval", async () => {
		const { client, db } = createTestDatabase("review-create-pending");
		const ada = insertUser(client, "ada");
		const pending = insertRestaurant(client, "Mangal Express", { suggestedBy: ada.id });
		const session = await signIn(db, ada.id);

		const result = await writeReview(db, session, pending.id, 8);
		const page = await renderPage(NewReviewPage, { db, session }, `/reviews/new?restaurant=${pending.id}`);

		expect(result.error?.code).toBe("FORBIDDEN");
		expect(client.query.reviews.findMany().sync()).toEqual([]);
		expect(page.response.status).toBe(403);
	});

	it("accepts ratings from 1 to 5 stars in half stars, and nothing else", async () => {
		const { client, db } = createTestDatabase("review-create-rating");
		const ada = insertUser(client, "ada");
		const grill = insertRestaurant(client, "Bosporus Grill", { status: "approved" });
		const session = await signIn(db, ada.id);

		for (const rating of [1, 11, 7.5]) {
			const result = await writeReview(db, session, grill.id, rating);
			expect(result.error && isInputError(result.error) && result.error.fields.rating).toBeTruthy();
		}
		expect(client.query.reviews.findMany().sync()).toEqual([]);
	});

	it("rates a restaurant by the three most recent reviews of each user, and weighs every user the same", async () => {
		const { client, db } = createTestDatabase("review-create-window");
		const ada = insertUser(client, "ada");
		const bob = insertUser(client, "bob");
		const grill = insertRestaurant(client, "Bosporus Grill", { status: "approved" });
		const adaSession = await signIn(db, ada.id);

		for (const rating of [2, 10, 10, 10]) {
			reviewIdOf(await writeReview(db, adaSession, grill.id, rating));
		}
		reviewIdOf(await writeReview(db, await signIn(db, bob.id), grill.id, 6));

		expect(restaurantRow(client, grill.id)).toMatchObject({ ratingAvg: 8, reviewCount: 5 });
	});
});

describe("reviews.update action", () => {
	it("lets the author change the rating and the text, and no one else, not even an admin", async () => {
		const { client, db } = createTestDatabase("review-update");
		const admin = insertUser(client, "root_admin", "admin");
		const ada = insertUser(client, "ada");
		const bob = insertUser(client, "bob");
		const grill = insertRestaurant(client, "Bosporus Grill", { status: "approved" });
		const adaSession = await signIn(db, ada.id);
		const id = reviewIdOf(await writeReview(db, adaSession, grill.id, 4, "Too salty."));
		const change = (session: SessionWithUser, description: string) =>
			server.reviews.update.call(actionContext(db, session), form({ reviewId: id, rating: 8, description }));

		const byBob = await change(await signIn(db, bob.id), "Bob was here.");
		const byAdmin = await change(await signIn(db, admin.id), "An admin was here.");
		const byAda = await change(adaSession, "Better on a second visit.");

		expect(byBob.error?.code).toBe("FORBIDDEN");
		expect(byAdmin.error?.code).toBe("FORBIDDEN");
		expect(byAda.data).toEqual({ redirect: `/reviews/${id}` });
		expect(client.query.reviews.findFirst({ where: { id } }).sync()).toMatchObject({
			rating: 8,
			description: "Better on a second visit.",
		});
		expect(restaurantRow(client, grill.id)?.ratingAvg).toBe(8);
	});

	it("shows the edit page only to the author", async () => {
		const { client, db } = createTestDatabase("review-update-page");
		const ada = insertUser(client, "ada");
		const bob = insertUser(client, "bob");
		const grill = insertRestaurant(client, "Bosporus Grill", { status: "approved" });
		const review = insertReview(client, ada.id, grill.id, 6);
		const render = async (userId: number) =>
			renderPage(EditReviewPage, { db, session: await signIn(db, userId) }, `/reviews/${review.id}/edit`, { id: String(review.id) });

		const asAda = await render(ada.id);
		const asBob = await render(bob.id);

		expect(asAda.response.status).toBe(200);
		expect(asAda.html).toContain('<option value="6" selected>3 out of 5 stars</option>');
		expect(asBob.response.status).toBe(403);
	});
});

describe("reviews.delete action", () => {
	it("deletes the review of the author and takes it out of the rating", async () => {
		const { client, db } = createTestDatabase("review-delete");
		const ada = insertUser(client, "ada");
		const bob = insertUser(client, "bob");
		const grill = insertRestaurant(client, "Bosporus Grill", { status: "approved" });
		const adaSession = await signIn(db, ada.id);
		const id = reviewIdOf(await writeReview(db, adaSession, grill.id, 2));
		reviewIdOf(await writeReview(db, await signIn(db, bob.id), grill.id, 10));

		const result = await server.reviews.delete.call(actionContext(db, adaSession), form({ reviewId: id }));

		expect(result.data).toEqual({ redirect: "/reviews" });
		expect(client.query.reviews.findFirst({ where: { id } }).sync()).toBeUndefined();
		expect(restaurantRow(client, grill.id)).toMatchObject({ ratingAvg: 10, reviewCount: 1 });
	});

	it("lets an admin delete the review of another user, and no other user", async () => {
		const { client, db } = createTestDatabase("review-delete-admin");
		const admin = insertUser(client, "root_admin", "admin");
		const ada = insertUser(client, "ada");
		const bob = insertUser(client, "bob");
		const grill = insertRestaurant(client, "Bosporus Grill", { status: "approved" });
		const review = insertReview(client, ada.id, grill.id, 2);
		const remove = async (userId: number) =>
			server.reviews.delete.call(actionContext(db, await signIn(db, userId)), form({ reviewId: review.id }));

		expect((await remove(bob.id)).error?.code).toBe("FORBIDDEN");
		expect((await remove(admin.id)).data).toEqual({ redirect: `/restaurants/${grill.id}` });
		expect(client.query.reviews.findMany().sync()).toEqual([]);
	});
});

describe("reviews of banned users", () => {
	it("leave the restaurant page and its rating until the ban is lifted", async () => {
		const { client, db } = createTestDatabase("review-banned-author");
		const admin = insertUser(client, "root_admin", "admin");
		const ada = insertUser(client, "ada");
		const bob = insertUser(client, "bob");
		const grill = insertRestaurant(client, "Bosporus Grill", { status: "approved" });
		reviewIdOf(await writeReview(db, await signIn(db, ada.id), grill.id, 10, "Best in town."));
		reviewIdOf(await writeReview(db, await signIn(db, bob.id), grill.id, 2, "Spam spam spam."));
		const adaSession = await signIn(db, ada.id);

		await db.mutations.users.ban(admin.id, bob.username);

		expect(restaurantRow(client, grill.id)).toMatchObject({ ratingAvg: 10, reviewCount: 1 });
		expect((await renderRestaurant(db, adaSession, grill.id)).html).not.toContain("Spam spam spam.");

		await db.mutations.users.unban(admin.id, bob.username);

		expect(restaurantRow(client, grill.id)).toMatchObject({ ratingAvg: 6, reviewCount: 2 });
		expect((await renderRestaurant(db, adaSession, grill.id)).html).toContain("Spam spam spam.");
	});
});
