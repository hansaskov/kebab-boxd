import { experimental_AstroContainer as AstroContainer } from "astro/container";
import type { APIContext } from "astro";
import { describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { server } from "@src/actions/index";
import { getSession, sessionCookieName } from "@src/auth/session";
import type { Client } from "@src/db/client";
import * as s from "@src/db/schema";
import { actionContext, form } from "@src/tests/actions";
import { renderEndpoint } from "@src/tests/container";
import { createTestDatabase, insertRestaurant, insertReview, insertUser, signIn } from "@src/tests/database";

function insertPicture(client: Client, url: string) {
	return client.insert(s.pictures).values({ url }).returning().get();
}

function restaurant(client: Client, id: number) {
	return client.select().from(s.restaurants).where(eq(s.restaurants.id, id)).get();
}

describe("users.delete", () => {
	it("deletes the user and everything that belongs to them, and keeps what belongs to others", async () => {
		const { client, db } = createTestDatabase("account-deletion-cascade");
		const adaPicture = insertPicture(client, "https://pictures.example/ada.webp");
		const bobPicture = insertPicture(client, "https://pictures.example/bob.webp");
		const adaReviewPicture = insertPicture(client, "https://pictures.example/ada-review.webp");
		const bobReviewPicture = insertPicture(client, "https://pictures.example/bob-review.webp");
		const ada = insertUser(client, "ada");
		const bob = insertUser(client, "bob");
		client.update(s.users).set({ profilePictureId: adaPicture.id }).where(eq(s.users.id, ada.id)).run();
		client.update(s.users).set({ profilePictureId: bobPicture.id }).where(eq(s.users.id, bob.id)).run();
		const grill = insertRestaurant(client, "Bosporus Grill");
		const suggested = insertRestaurant(client, "Mangal Express", { suggestedBy: ada.id });
		const adaReview = insertReview(client, ada.id, grill.id, 10);
		const bobReview = insertReview(client, bob.id, grill.id, 4);
		client.insert(s.reviewPictures).values([
			{ reviewId: adaReview.id, pictureId: adaReviewPicture.id },
			{ reviewId: bobReview.id, pictureId: bobReviewPicture.id },
		]).run();
		const adaSession = await signIn(db, ada.id);
		client.insert(s.accounts).values({ userId: ada.id, providerId: "google", accountId: "ada-google" }).run();
		client.insert(s.history)
			.values({ sessionId: adaSession!.id, requestedAt: new Date(), method: "GET", route: "/", path: "/", status: 200 })
			.run();
		client.insert(s.likes).values({ userId: bob.id, reviewId: adaReview.id }).run();
		client.insert(s.followers).values([
			{ followerId: ada.id, followingId: bob.id },
			{ followerId: bob.id, followingId: ada.id },
		]).run();
		client.insert(s.favorites).values({ userId: ada.id, restaurantId: grill.id }).run();
		client.insert(s.bucketList).values({ userId: ada.id, restaurantId: grill.id }).run();

		expect(await db.mutations.users.delete(ada.id, ada.id)).toBe("updated");

		expect(await db.queries.users.findByUsername("ada")).toBeUndefined();
		expect((await db.queries.users.findByUsername("bob"))?.id).toBe(bob.id);
		expect(client.select().from(s.sessions).all()).toEqual([]);
		expect(client.select().from(s.history).all()).toEqual([]);
		expect(client.select().from(s.accounts).all()).toEqual([]);
		expect(client.select({ id: s.reviews.id }).from(s.reviews).all()).toEqual([{ id: bobReview.id }]);
		expect(client.select().from(s.likes).all()).toEqual([]);
		expect(client.select().from(s.followers).all()).toEqual([]);
		expect(client.select().from(s.favorites).all()).toEqual([]);
		expect(client.select().from(s.bucketList).all()).toEqual([]);
		expect(client.select({ id: s.pictures.id }).from(s.pictures).orderBy(s.pictures.id).all()).toEqual([
			{ id: bobPicture.id },
			{ id: bobReviewPicture.id },
		]);
		expect(restaurant(client, suggested.id)?.suggestedBy).toBeNull();
	});

	it("removes the likes of the user from the like count of other reviews", async () => {
		const { client, db } = createTestDatabase("account-deletion-like-count");
		const ada = insertUser(client, "ada");
		const bob = insertUser(client, "bob");
		const cleo = insertUser(client, "cleo");
		const bobReview = insertReview(client, bob.id, insertRestaurant(client, "Hasir Kebab").id, 6);
		client.insert(s.likes).values([
			{ userId: ada.id, reviewId: bobReview.id },
			{ userId: cleo.id, reviewId: bobReview.id },
		]).run();
		client.update(s.reviews).set({ likeCount: 2 }).where(eq(s.reviews.id, bobReview.id)).run();

		await db.mutations.users.delete(ada.id, ada.id);

		expect(client.select().from(s.reviews).where(eq(s.reviews.id, bobReview.id)).get()?.likeCount).toBe(1);
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

		await db.mutations.users.delete(ada.id, ada.id);

		expect(restaurant(client, reviewed.id)).toMatchObject({ reviewCount: 4, ratingAvg: 8 });
		expect(restaurant(client, onlyAda.id)).toMatchObject({ reviewCount: 0, ratingAvg: 0 });
		expect(restaurant(client, untouched.id)).toMatchObject({ reviewCount: 7, ratingAvg: 3 });
	});
});

describe("deleteAccount action", () => {
	it("does not let an admin delete any account, so an admin always remains", async () => {
		const { client, db } = createTestDatabase("delete-account-admin");
		const admin = insertUser(client, "ada", "admin");
		insertUser(client, "bob");
		const session = await signIn(db, admin.id);

		for (const username of ["ada", "bob"]) {
			const result = await server.deleteAccount.call(
				actionContext(db, session),
				form({ currentUsername: username, confirmation: username }),
			);

			expect(result.error?.code).toBe("FORBIDDEN");
			expect(await db.queries.users.findByUsername(username)).toBeDefined();
		}
	});

	it("deletes the account, clears the session cookie and sends the user to the login page", async () => {
		const { client, db } = createTestDatabase("delete-account-success");
		const ada = insertUser(client, "ada");
		const session = await signIn(db, ada.id);
		const container = await AstroContainer.create();
		const endpoint = {
			POST: async (context: APIContext) => {
				Reflect.set(context, Symbol.for("astro.actionAPIContext"), true);
				const result = await server.deleteAccount.call(context, form({ currentUsername: "ada", confirmation: "ada" }));
				return Response.json({ data: result.data, setCookies: [...context.cookies.headers()] });
			},
		};

		const response = await renderEndpoint(container, endpoint, {
			locals: { db, session },
			request: new Request("http://localhost/ada/settings", { method: "POST" }),
		});

		const { data, setCookies } = await response.json();
		expect(data).toEqual({ redirect: "/login?notice=account-deleted" });
		expect(setCookies).toEqual([expect.stringMatching(new RegExp(`^${sessionCookieName}=;.*Max-Age=0`))]);
		expect(await db.queries.users.findByUsername("ada")).toBeUndefined();
		expect(await getSession(session!.id, db)).toBeNull();
	});
});
