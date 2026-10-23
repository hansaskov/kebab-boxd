import { experimental_AstroContainer as AstroContainer } from "astro/container";
import { describe, expect, it } from "vitest";
import * as ExportEndpoint from "@src/pages/api/users/[username]/export";
import ForbiddenPage from "@src/pages/403.astro";
import NotFoundPage from "@src/pages/404.astro";
import { createSession, getSession } from "@src/auth/session";
import type { Database } from "@src/db";
import * as s from "@src/db/schema";
import { renderEndpoint } from "@src/tests/container";
import { createTestDatabase, insertRestaurant, insertReview, insertUser } from "@src/tests/database";

async function requestExport(db: Database, viewerSessionId: string, username: string) {
	const container = await AstroContainer.create();
	container.insertPageRoute("/403", ForbiddenPage);
	container.insertPageRoute("/404", NotFoundPage);
	return renderEndpoint(container, ExportEndpoint, {
		locals: { db, session: await getSession(viewerSessionId, db) },
		params: { username },
		request: new Request(`http://localhost/api/users/${username}/export`),
	});
}

describe("GET /api/users/[username]/export", () => {
	it("downloads everything stored about the user", async () => {
		const { client, db } = createTestDatabase("export-complete");
		const picture = client.insert(s.pictures).values({ url: "https://pictures.example/ada.webp" }).returning().get();
		const ada = client.insert(s.users)
			.values({ fullname: "Ada Lovelace", username: "ada", email: "ada@example.com", bio: "Döner fan", profilePictureId: picture.id })
			.returning()
			.get();
		const bob = insertUser(client, "bob");
		const grill = insertRestaurant(client, "Bosporus Grill");
		const suggested = insertRestaurant(client, "Mangal Express", { suggestedBy: ada.id });
		const reviewPicture = client.insert(s.pictures).values({ url: "https://pictures.example/review.webp" }).returning().get();
		const adaReview = client.insert(s.reviews)
			.values({ authorId: ada.id, restaurantId: grill.id, rating: 9, description: "Crispy" })
			.returning()
			.get();
		client.insert(s.reviewPictures).values({ reviewId: adaReview.id, pictureId: reviewPicture.id }).run();
		const bobReview = insertReview(client, bob.id, grill.id, 4);
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

		const response = await requestExport(db, session.id, "ada");

		expect(response.status).toBe(200);
		expect(response.headers.get("Content-Disposition")).toMatch(/^attachment; filename="kebab-boxd-ada-\d{4}-\d{2}-\d{2}\.json"$/);
		expect((await response.json()).user).toMatchObject({
			fullname: "Ada Lovelace",
			username: "ada",
			email: "ada@example.com",
			bio: "Döner fan",
			profilePicture: { url: "https://pictures.example/ada.webp" },
			accounts: [{ providerId: "google", accountId: "ada-google" }],
			sessions: [{ theme: "light", history: [{ method: "GET", path: "/explore", status: 200, prefetched: false }] }],
			reviews: [
				{
					restaurant: { name: "Bosporus Grill" },
					rating: 9,
					description: "Crispy",
					pictures: [{ url: "https://pictures.example/review.webp" }],
				},
			],
			likes: [{ review: { author: { username: "bob" }, restaurant: { name: "Bosporus Grill" } } }],
			following: [{ following: { username: "bob" } }],
			followers: [{ follower: { username: "bob" } }],
			favorites: [{ restaurant: { name: "Bosporus Grill" } }],
			bucketList: [{ restaurant: { name: "Mangal Express" } }],
			suggestions: [{ name: "Mangal Express", status: "pending" }],
		});
	});

	it("leaves out session secrets and the private data of other users", async () => {
		const { client, db } = createTestDatabase("export-private");
		const ada = insertUser(client, "ada");
		const bob = insertUser(client, "bob");
		client.insert(s.followers).values({ followerId: ada.id, followingId: bob.id }).run();
		const session = await createSession(ada.id, db);

		const exported = await (await requestExport(db, session.id, "ada")).text();

		expect(exported).toContain(ada.email);
		expect(exported).not.toContain(session.id);
		expect(exported).not.toContain(session.secretHash.toString("hex"));
		expect(exported).not.toContain("Buffer");
		expect(exported).not.toContain(bob.email);
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
});
