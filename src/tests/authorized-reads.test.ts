import { describe, expect, it } from "vitest";
import ProfilePage from "@src/pages/[username]/profile.astro";
import { renderPage } from "@src/tests/container";
import { allowed, createTestDatabase, firstPage, insertRestaurant, insertUser, signIn, writeReview } from "@src/tests/database";

describe("A read the viewer may not do", () => {
	it("gives no Reviews of a Restaurant the viewer may not see", async () => {
		const { client, db } = createTestDatabase();
		const ada = insertUser(client, "ada");
		const bob = insertUser(client, "bob");
		const pending = insertRestaurant(client, "Bosporus Grill", { suggestedBy: ada.id });

		expect({
			visitor: await db.reviews.listByRestaurant(pending.id, null, firstPage),
			other: await db.reviews.listByRestaurant(pending.id, bob.id, firstPage),
			missing: await db.reviews.listByRestaurant(pending.id + 1, ada.id, firstPage),
			suggester: allowed(await db.reviews.listByRestaurant(pending.id, ada.id, firstPage)).items,
		}).toEqual({
			visitor: { problem: "not-found", permission: "restaurant:view" },
			other: { problem: "not-found", permission: "restaurant:view" },
			missing: { problem: "not-found", permission: "restaurant:view" },
			suggester: [],
		});
	});

	it("gives a Restaurant or a Review only with the permission the page needs", async () => {
		const { client, db } = createTestDatabase();
		const ada = insertUser(client, "ada");
		const bob = insertUser(client, "bob");
		const grill = insertRestaurant(client, "Bosporus Grill", { status: "approved" });
		const reviewId = await writeReview(db, ada.id, grill.id, 8);

		expect({
			restaurantToVisitor: allowed(await db.restaurants.findAllowed(grill.id, null, "restaurant:view")).name,
			reviewByVisitor: await db.restaurants.findAllowed(grill.id, null, "restaurant:review"),
			reviewToOther: allowed(await db.reviews.findAllowed(reviewId, bob.id, "review:view")).id,
			editByOther: await db.reviews.findAllowed(reviewId, bob.id, "review:edit"),
			editByAuthor: allowed(await db.reviews.findAllowed(reviewId, ada.id, "review:edit")).id,
		}).toEqual({
			restaurantToVisitor: "Bosporus Grill",
			reviewByVisitor: { problem: "forbidden", permission: "restaurant:review" },
			reviewToOther: reviewId,
			editByOther: { problem: "forbidden", permission: "review:edit" },
			editByAuthor: reviewId,
		});
	});

	it("gives the settings and the data of a User only to whoever may open them", async () => {
		const { client, db } = createTestDatabase();
		const ada = insertUser(client, "ada");
		const bob = insertUser(client, "bob");

		expect({
			settingsOfOther: await db.users.findAllowed("ada", bob.id, "user:edit-settings"),
			ownSettings: allowed(await db.users.findAllowed("ADA", ada.id, "user:edit-settings")).username,
			dataOfOther: await db.personalData.exportFor("ada", bob.id),
			missing: await db.personalData.exportFor("cleo", bob.id),
			ownData: allowed(await db.personalData.exportFor("ada", ada.id))?.username,
		}).toEqual({
			settingsOfOther: { problem: "forbidden", permission: "user:edit-settings" },
			ownSettings: "ada",
			dataOfOther: { problem: "forbidden", permission: "user:export-data" },
			missing: { problem: "not-found", permission: "user:export-data" },
			ownData: "ada",
		});
	});
});

describe("The follow requests of a Profile", () => {
	it("open for their User, and lead anyone else to the Reviews", async () => {
		const { client, db } = createTestDatabase();
		const ada = insertUser(client, "ada");
		const bob = insertUser(client, "bob");
		const open = async (viewerId: number | null) => {
			const session = viewerId === null ? null : await signIn(db, viewerId);
			const { response } = await renderPage(ProfilePage, { db, session }, "/ada/profile?tab=requests", { username: "ada" });
			return [response.status, response.headers.get("Location")];
		};

		expect({ own: await open(ada.id), other: await open(bob.id), visitor: await open(null) }).toEqual({
			own: [200, null],
			other: [302, "/ada/profile"],
			visitor: [302, "/ada/profile"],
		});
	});
});
