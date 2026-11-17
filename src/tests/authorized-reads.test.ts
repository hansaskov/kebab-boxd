import { describe, expect, it } from "vitest";
import ProfilePage from "@src/pages/[username]/profile.astro";
import { isProblem } from "@src/db/problem";
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

describe("A read of the admin console", () => {
	it("gives its data only to an Admin, not to a User or a Visitor", async () => {
		const { client, db } = createTestDatabase();
		const admin = insertUser(client, "root_admin", "admin");
		const ada = insertUser(client, "ada");
		const reads = (viewerId: number | null) =>
			Promise.all([
				db.users.countByFilter(viewerId),
				db.users.list("", "all", viewerId, firstPage),
				db.users.findInAdminConsole("ada", viewerId),
				db.restaurants.countByStatus(viewerId),
				db.restaurants.listByStatus("pending", viewerId, firstPage),
				db.cities.status(viewerId),
				db.citySearches.list(viewerId, firstPage),
				db.citySearches.findCities("odense", 5, viewerId),
				db.citySearches.findById(1, viewerId),
			]);
		const refused = { problem: "forbidden", permission: "admin-console:view" };

		expect(await reads(null)).toEqual(Array(9).fill(refused));
		expect(await reads(ada.id)).toEqual(Array(9).fill(refused));
		expect((await reads(admin.id)).filter((read) => isProblem(read))).toEqual([]);
	});
});

describe("A read of what a User keeps for themselves", () => {
	it("refuses the suggestions to a Visitor, and gives a User their own", async () => {
		const { client, db } = createTestDatabase();
		const ada = insertUser(client, "ada");
		insertRestaurant(client, "Bosporus Grill", { suggestedBy: ada.id });
		insertRestaurant(client, "Mangal Express");

		expect({
			visitorSuggested: await db.restaurants.listSuggestedBy(null, firstPage),
			visitorQueued: await db.suggestionQueue.listBy(null),
			suggested: allowed(await db.restaurants.listSuggestedBy(ada.id, firstPage)).items.map((restaurant) => restaurant.name),
			queued: allowed(await db.suggestionQueue.listBy(ada.id)),
		}).toEqual({
			visitorSuggested: { problem: "forbidden", permission: "restaurant:suggest" },
			visitorQueued: { problem: "forbidden", permission: "restaurant:suggest" },
			suggested: ["Bosporus Grill"],
			queued: [],
		});
	});

	it("shows a Visitor no Notifications and the Everyone Feed", async () => {
		const { client, db } = createTestDatabase();
		const ada = insertUser(client, "ada");
		const bob = insertUser(client, "bob");
		const grill = insertRestaurant(client, "Bosporus Grill", { status: "approved" });
		await writeReview(db, bob.id, grill.id, 8);
		await db.follows.follow(bob.id, ada.username);

		expect({
			notifications: await db.notifications.show(null, firstPage),
			visitorFeed: (await db.reviews.listFeed("following", null, firstPage)).feed,
			visitorReviews: (await db.reviews.listFeed("following", null, firstPage)).page.items.length,
			followingFeed: (await db.reviews.listFeed("following", ada.id, firstPage)).page.items.length,
			everyoneFeed: (await db.reviews.listFeed("everyone", ada.id, firstPage)).page.items.length,
		}).toEqual({
			notifications: { page: { items: [], previous: undefined, next: undefined, isPastEnd: false }, unreadCount: 0 },
			visitorFeed: "everyone",
			visitorReviews: 1,
			followingFeed: 0,
			everyoneFeed: 1,
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
