import { experimental_AstroContainer as AstroContainer } from "astro/container";
import { describe, expect, it } from "vitest";
import * as ExportEndpoint from "@src/pages/api/users/[username]/export";
import ForbiddenPage from "@src/pages/403.astro";
import NotFoundPage from "@src/pages/404.astro";
import { createSession, getSession } from "@src/auth/session";
import type { Database } from "@src/db";
import type { Client } from "@src/db/client";
import * as s from "@src/db/schema";
import { renderEndpoint } from "@src/tests/container";
import { createTestDatabase, insertUser } from "@src/tests/database";

function insertRestaurant(client: Client, name: string, suggestedBy: number | null = null) {
	const location = client.insert(s.locations).values({ latitude: 55.68, longitude: 12.57 }).returning().get();
	return client.insert(s.restaurants).values({ name, locationId: location.id, suggestedBy }).returning().get();
}

async function requestExport(db: Database, viewerSessionId: string | null, username: string) {
	const container = await AstroContainer.create();
	container.insertPageRoute("/403", ForbiddenPage);
	container.insertPageRoute("/404", NotFoundPage);
	return renderEndpoint(container, ExportEndpoint, {
		locals: { db, session: viewerSessionId ? await getSession(viewerSessionId, db) : null },
		params: { username },
		request: new Request(`http://localhost/api/users/${username}/export`),
	});
}

describe("personalData.findByUser", () => {
	it("collects everything stored about the user", async () => {
		const { client, db } = createTestDatabase("personal-data-complete");
		const picture = client.insert(s.pictures).values({ url: "https://pictures.example/ada.webp" }).returning().get();
		const ada = client.insert(s.users)
			.values({ fullname: "Ada Lovelace", username: "ada", email: "ada@example.com", bio: "Döner fan", profilePictureId: picture.id })
			.returning()
			.get();
		const bob = insertUser(client, "bob");
		const grill = insertRestaurant(client, "Bosporus Grill");
		const suggested = insertRestaurant(client, "Mangal Express", ada.id);
		const reviewPicture = client.insert(s.pictures).values({ url: "https://pictures.example/review.webp" }).returning().get();
		const adaReview = client.insert(s.reviews)
			.values({ authorId: ada.id, restaurantId: grill.id, rating: 9, description: "Crispy" })
			.returning()
			.get();
		client.insert(s.reviewPictures).values({ reviewId: adaReview.id, pictureId: reviewPicture.id }).run();
		const bobReview = client.insert(s.reviews).values({ authorId: bob.id, restaurantId: grill.id, rating: 4 }).returning().get();
		client.insert(s.likes).values({ userId: ada.id, reviewId: bobReview.id }).run();
		client.insert(s.followers).values([
			{ followerId: ada.id, followingId: bob.id },
			{ followerId: bob.id, followingId: ada.id },
		]).run();
		client.insert(s.favorites).values({ userId: ada.id, restaurantId: grill.id }).run();
		client.insert(s.bucketList).values({ userId: ada.id, restaurantId: suggested.id }).run();
		client.insert(s.accounts).values({ userId: ada.id, providerId: "google", accountId: "ada-google" }).run();
		const session = await createSession(ada.id, db);
		client.insert(s.history)
			.values({ sessionId: session.id, requestedAt: new Date(), method: "GET", route: "/explore", path: "/explore", status: 200 })
			.run();

		const data = await db.queries.personalData.findByUser(ada.id);

		expect(data).toMatchObject({
			profile: {
				fullname: "Ada Lovelace",
				username: "ada",
				email: "ada@example.com",
				bio: "Döner fan",
				profilePicture: "https://pictures.example/ada.webp",
			},
			accounts: [{ providerId: "google", accountId: "ada-google" }],
			sessions: [{ theme: "light", history: [{ method: "GET", path: "/explore", status: 200, prefetched: false }] }],
			reviews: [
				{
					restaurant: "Bosporus Grill",
					stars: 4.5,
					description: "Crispy",
					pictures: ["https://pictures.example/review.webp"],
				},
			],
			likes: [{ author: "bob", restaurant: "Bosporus Grill" }],
			following: [{ username: "bob" }],
			followers: [{ username: "bob" }],
			favorites: [{ restaurant: "Bosporus Grill" }],
			bucketList: [{ restaurant: "Mangal Express" }],
			suggestions: [{ restaurant: "Mangal Express", status: "pending" }],
		});
	});

	it("leaves out session secrets and the private data of other users", async () => {
		const { client, db } = createTestDatabase("personal-data-private");
		const ada = insertUser(client, "ada");
		const bob = insertUser(client, "bob");
		client.insert(s.followers).values({ followerId: ada.id, followingId: bob.id }).run();
		const session = await createSession(ada.id, db);

		const exported = JSON.stringify(await db.queries.personalData.findByUser(ada.id));

		expect(exported).not.toContain(session.id);
		expect(exported).not.toContain(session.secretHash.toString("hex"));
		expect(exported).not.toContain("Buffer");
		expect(exported).not.toContain(bob.email);
	});

	it("returns nothing for a user who does not exist", async () => {
		const { db } = createTestDatabase("personal-data-missing");

		expect(await db.queries.personalData.findByUser(404)).toBeUndefined();
	});
});

describe("GET /api/users/[username]/export", () => {
	it("downloads the data of the signed-in user as a JSON file", async () => {
		const { client, db } = createTestDatabase("export-own");
		const ada = insertUser(client, "ada");
		const session = await createSession(ada.id, db);

		const response = await requestExport(db, session.id, "ada");

		expect(response.status).toBe(200);
		expect(response.headers.get("Content-Type")).toBe("application/json; charset=utf-8");
		expect(response.headers.get("Content-Disposition")).toMatch(/^attachment; filename="kebab-boxd-ada-\d{4}-\d{2}-\d{2}\.json"$/);
		expect(response.headers.get("Cache-Control")).toBe("no-store");
		expect(await response.json()).toMatchObject({ profile: { username: "ada", email: ada.email } });
	});

	it("does not let a user download the data of someone else", async () => {
		const { client, db } = createTestDatabase("export-forbidden");
		const ada = insertUser(client, "ada");
		insertUser(client, "bob");
		const session = await createSession(ada.id, db);

		const response = await requestExport(db, session.id, "bob");

		expect(response.status).toBe(403);
		expect(await response.text()).not.toContain("bob@example.com");
	});

	it("does not let an admin download the data of another user", async () => {
		const { client, db } = createTestDatabase("export-admin");
		const admin = insertUser(client, "ada", "admin");
		insertUser(client, "bob");
		const session = await createSession(admin.id, db);

		const response = await requestExport(db, session.id, "bob");

		expect(response.status).toBe(403);
		expect(await response.text()).not.toContain("bob@example.com");
	});

	it("sends a visitor who is not signed in to the login page", async () => {
		const { db } = createTestDatabase("export-anonymous");

		const response = await requestExport(db, null, "ada");

		expect(response.status).toBe(302);
		expect(response.headers.get("Location")).toBe("/login");
	});
});
