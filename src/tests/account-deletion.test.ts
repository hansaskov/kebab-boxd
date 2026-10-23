import { experimental_AstroContainer as AstroContainer } from "astro/container";
import type { APIContext } from "astro";
import { describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { server } from "@src/actions/index";
import { can } from "@src/auth/permissions";
import { createSession, getSession, sessionCookieName } from "@src/auth/session";
import type { Database } from "@src/db";
import type { Client } from "@src/db/client";
import * as s from "@src/db/schema";
import { renderEndpoint } from "@src/tests/container";
import { createTestDatabase, insertUser } from "@src/tests/database";

function deleteAs(db: Database, actorId: number, userId: number) {
	return db.mutations.users.delete(userId, actorId, (actor, target) => can(actor, "user:delete-account", target));
}

function confirmationForm(currentUsername: string, confirmation: string) {
	const formData = new FormData();
	formData.set("currentUsername", currentUsername);
	formData.set("confirmation", confirmation);
	return formData;
}

async function deleteAccountAs(db: Database, sessionId: string, currentUsername: string, confirmation: string) {
	const actionContext = { locals: { db, session: await getSession(sessionId, db) } };
	Reflect.set(actionContext, Symbol.for("astro.actionAPIContext"), true);

	return server.deleteAccount.call(actionContext, confirmationForm(currentUsername, confirmation));
}

function insertRestaurant(client: Client, name: string, suggestedBy: number | null = null) {
	const location = client.insert(s.locations).values({ latitude: 55.68, longitude: 12.57 }).returning().get();
	return client.insert(s.restaurants).values({ name, locationId: location.id, suggestedBy }).returning().get();
}

function insertReview(client: Client, authorId: number, restaurantId: number, rating: number, createdAt = new Date()) {
	return client.insert(s.reviews).values({ authorId, restaurantId, rating, createdAt }).returning().get();
}

function insertPicture(client: Client, url: string) {
	return client.insert(s.pictures).values({ url }).returning().get();
}

function restaurant(client: Client, id: number) {
	return client.select().from(s.restaurants).where(eq(s.restaurants.id, id)).get();
}

function review(client: Client, id: number) {
	return client.select().from(s.reviews).where(eq(s.reviews.id, id)).get();
}

describe("users.delete", () => {
	it("deletes the user and everything that belongs to them", async () => {
		const { client, db } = createTestDatabase("account-deletion-cascade");
		const ada = insertUser(client, "ada");
		const bob = insertUser(client, "bob");
		const restaurant = insertRestaurant(client, "Bosporus Grill");
		const adaReview = insertReview(client, ada.id, restaurant.id, 10);
		const bobReview = insertReview(client, bob.id, restaurant.id, 4);
		const adaSession = await createSession(ada.id, db);
		client.insert(s.accounts).values({ userId: ada.id, providerId: "google", accountId: "ada-google" }).run();
		client.insert(s.history)
			.values({ sessionId: adaSession.id, requestedAt: new Date(), method: "GET", route: "/", path: "/", status: 200 })
			.run();
		client.insert(s.likes).values({ userId: bob.id, reviewId: adaReview.id }).run();
		client.insert(s.followers).values([
			{ followerId: ada.id, followingId: bob.id },
			{ followerId: bob.id, followingId: ada.id },
		]).run();
		client.insert(s.favorites).values({ userId: ada.id, restaurantId: restaurant.id }).run();
		client.insert(s.bucketList).values({ userId: ada.id, restaurantId: restaurant.id }).run();

		const result = await deleteAs(db, ada.id, ada.id);

		expect(result).toBe("updated");
		expect(await db.queries.users.findByUsername("ada")).toBeUndefined();
		expect(client.select().from(s.sessions).all()).toEqual([]);
		expect(client.select().from(s.history).all()).toEqual([]);
		expect(client.select().from(s.accounts).all()).toEqual([]);
		expect(client.select({ id: s.reviews.id }).from(s.reviews).all()).toEqual([{ id: bobReview.id }]);
		expect(client.select().from(s.likes).all()).toEqual([]);
		expect(client.select().from(s.followers).all()).toEqual([]);
		expect(client.select().from(s.favorites).all()).toEqual([]);
		expect(client.select().from(s.bucketList).all()).toEqual([]);
		expect((await db.queries.users.findByUsername("bob"))?.id).toBe(bob.id);
	});

	it("keeps restaurants the user suggested but forgets who suggested them", async () => {
		const { client, db } = createTestDatabase("account-deletion-suggestions");
		const ada = insertUser(client, "ada");
		const suggested = insertRestaurant(client, "Mangal Express", ada.id);

		await deleteAs(db, ada.id, ada.id);

		expect(restaurant(client, suggested.id)?.suggestedBy).toBeNull();
	});

	it("deletes the profile picture and review pictures of the user, and keeps those of others", async () => {
		const { client, db } = createTestDatabase("account-deletion-pictures");
		const adaPicture = insertPicture(client, "https://pictures.example/ada.webp");
		const bobPicture = insertPicture(client, "https://pictures.example/bob.webp");
		const adaReviewPicture = insertPicture(client, "https://pictures.example/ada-review.webp");
		const bobReviewPicture = insertPicture(client, "https://pictures.example/bob-review.webp");
		const ada = client.insert(s.users)
			.values({ fullname: "Ada", username: "ada", email: "ada@example.com", profilePictureId: adaPicture.id })
			.returning()
			.get();
		const bob = client.insert(s.users)
			.values({ fullname: "Bob", username: "bob", email: "bob@example.com", profilePictureId: bobPicture.id })
			.returning()
			.get();
		const restaurant = insertRestaurant(client, "Saray Döner");
		const adaReview = insertReview(client, ada.id, restaurant.id, 8);
		const bobReview = insertReview(client, bob.id, restaurant.id, 6);
		client.insert(s.reviewPictures).values([
			{ reviewId: adaReview.id, pictureId: adaReviewPicture.id },
			{ reviewId: bobReview.id, pictureId: bobReviewPicture.id },
		]).run();

		await deleteAs(db, ada.id, ada.id);

		expect(client.select({ id: s.pictures.id }).from(s.pictures).orderBy(s.pictures.id).all()).toEqual([
			{ id: bobPicture.id },
			{ id: bobReviewPicture.id },
		]);
		expect(client.select().from(s.reviewPictures).all()).toMatchObject([{ reviewId: bobReview.id }]);
	});

	it("removes the likes of the user from the like count of other reviews", async () => {
		const { client, db } = createTestDatabase("account-deletion-like-count");
		const ada = insertUser(client, "ada");
		const bob = insertUser(client, "bob");
		const cleo = insertUser(client, "cleo");
		const restaurant = insertRestaurant(client, "Hasir Kebab");
		const bobReview = insertReview(client, bob.id, restaurant.id, 6);
		client.insert(s.likes).values([
			{ userId: ada.id, reviewId: bobReview.id },
			{ userId: cleo.id, reviewId: bobReview.id },
		]).run();
		client.update(s.reviews).set({ likeCount: 2 }).where(eq(s.reviews.id, bobReview.id)).run();

		await deleteAs(db, ada.id, ada.id);

		expect(review(client, bobReview.id)?.likeCount).toBe(1);
	});

	it("removes the reviews of the user from the rating and review count of restaurants", async () => {
		const { client, db } = createTestDatabase("account-deletion-rating");
		const ada = insertUser(client, "ada");
		const bob = insertUser(client, "bob");
		const reviewed = insertRestaurant(client, "Urfa Grillhaus");
		const onlyAda = insertRestaurant(client, "Dergah Kebab");
		const untouched = insertRestaurant(client, "Kösk Kebap");
		insertReview(client, ada.id, reviewed.id, 10);
		insertReview(client, ada.id, onlyAda.id, 10);
		const day = 24 * 60 * 60 * 1000;
		for (const [age, rating] of [[4, 2], [3, 10], [2, 6], [1, 8]] as const) {
			insertReview(client, bob.id, reviewed.id, rating, new Date(Date.now() - age * day));
		}
		client.update(s.restaurants).set({ ratingAvg: 9, reviewCount: 5 }).where(eq(s.restaurants.id, reviewed.id)).run();
		client.update(s.restaurants).set({ ratingAvg: 10, reviewCount: 1 }).where(eq(s.restaurants.id, onlyAda.id)).run();
		client.update(s.restaurants).set({ ratingAvg: 3, reviewCount: 7 }).where(eq(s.restaurants.id, untouched.id)).run();

		await deleteAs(db, ada.id, ada.id);

		expect(restaurant(client, reviewed.id)).toMatchObject({ reviewCount: 4, ratingAvg: 8 });
		expect(restaurant(client, onlyAda.id)).toMatchObject({ reviewCount: 0, ratingAvg: 0 });
		expect(restaurant(client, untouched.id)).toMatchObject({ reviewCount: 7, ratingAvg: 3 });
	});

	it("refuses when the user became an admin since the request started", async () => {
		const { client, db } = createTestDatabase("account-deletion-refused");
		const ada = insertUser(client, "ada");
		client.update(s.users).set({ role: "admin" }).where(eq(s.users.id, ada.id)).run();

		const result = await deleteAs(db, ada.id, ada.id);

		expect(result).toBe("refused");
		expect((await db.queries.users.findByUsername("ada"))?.id).toBe(ada.id);
	});
});

describe("deleteAccount action", () => {
	it("refuses when the confirmation does not match the username", async () => {
		const { client, db } = createTestDatabase("delete-account-confirmation");
		const ada = insertUser(client, "ada");
		const session = await createSession(ada.id, db);

		const result = await deleteAccountAs(db, session.id, "ada", "Ada");

		expect(result.error?.code).toBe("BAD_REQUEST");
		expect(result.error && "fields" in result.error && result.error.fields).toMatchObject({
			confirmation: ["Type your username exactly as shown."],
		});
		expect((await db.queries.users.findByUsername("ada"))?.id).toBe(ada.id);
	});

	it("does not let a user delete someone else's account", async () => {
		const { client, db } = createTestDatabase("delete-account-other");
		const ada = insertUser(client, "ada");
		const bob = insertUser(client, "bob");
		const session = await createSession(ada.id, db);

		const result = await deleteAccountAs(db, session.id, "bob", "bob");

		expect(result.error?.code).toBe("FORBIDDEN");
		expect((await db.queries.users.findByUsername("bob"))?.id).toBe(bob.id);
	});

	it("does not let an admin delete their own account", async () => {
		const { client, db } = createTestDatabase("delete-account-admin");
		const admin = insertUser(client, "ada", "admin");
		const session = await createSession(admin.id, db);

		const result = await deleteAccountAs(db, session.id, "ada", "ada");

		expect(result.error?.code).toBe("FORBIDDEN");
		expect((await db.queries.users.findByUsername("ada"))?.id).toBe(admin.id);
	});

	it("deletes the account, clears the session cookie and sends the user to the login page", async () => {
		const { client, db } = createTestDatabase("delete-account-success");
		const ada = insertUser(client, "ada");
		const session = await createSession(ada.id, db);
		const container = await AstroContainer.create();
		const endpoint = {
			POST: async (context: APIContext) => {
				Reflect.set(context, Symbol.for("astro.actionAPIContext"), true);
				const result = await server.deleteAccount.call(context, confirmationForm("ada", "ada"));
				return Response.json({ data: result.data, setCookies: [...context.cookies.headers()] });
			},
		};

		const response = await renderEndpoint(container, endpoint, {
			locals: { db, session: await getSession(session.id, db) },
			request: new Request("http://localhost/ada/settings", { method: "POST" }),
		});

		const { data, setCookies } = await response.json();
		expect(data).toEqual({ redirect: "/login?notice=account-deleted" });
		expect(setCookies).toEqual([expect.stringMatching(new RegExp(`^${sessionCookieName}=;.*Max-Age=0`))]);
		expect(await db.queries.users.findByUsername("ada")).toBeUndefined();
		expect(await getSession(session.id, db)).toBeNull();
	});
});
