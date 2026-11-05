import { describe, expect, it } from "vitest";
import type { Database } from "@src/db";
import { isProblem } from "@src/db/problem";
import FeedPage from "@src/pages/feed.astro";
import NotificationsPage from "@src/pages/notifications.astro";
import ProfilePage from "@src/pages/[username]/profile.astro";
import RestaurantPage from "@src/pages/restaurants/[id].astro";
import ReviewPage from "@src/pages/reviews/[id]/index.astro";
import { renderPage } from "@src/tests/container";
import { createTestDatabase, firstPage, insertRestaurant, insertReview, insertUser, restaurantRow, signIn } from "@src/tests/database";

async function publish(db: Database, authorId: number, restaurantId: number, description: string) {
	const review = await db.reviews.create(authorId, restaurantId, { rating: 8, description }, []);
	if (isProblem(review)) throw new Error(`The review was refused: ${review.problem}.`);
	return review.id;
}

async function sessionOf(db: Database, userId: number | null) {
	return userId === null ? null : signIn(db, userId);
}

// Where the viewer, null for a Visitor, finds the Review: on the Profile of its author, on its own page, on its
// Restaurant and in the Feed of everyone.
async function whereShown(db: Database, viewerId: number | null, review: { id: number; author: string; restaurantId: number; text: string }) {
	const locals = { db, session: await sessionOf(db, viewerId) };
	const id = String(review.id);
	const restaurantId = String(review.restaurantId);
	const profile = await renderPage(ProfilePage, locals, `/${review.author}/profile`, { username: review.author });
	const page = await renderPage(ReviewPage, locals, `/reviews/${id}`, { id });
	const restaurant = await renderPage(RestaurantPage, locals, `/restaurants/${restaurantId}`, { id: restaurantId });
	const feed = await renderPage(FeedPage, locals, "/feed?feed=everyone");
	return [profile.html, page.response.status === 200 && page.html, restaurant.html, feed.html].map((html) => html !== false && html.includes(review.text));
}

const usernames = (people: { username: string }[]) => people.map((person) => person.username).toSorted();

// The notifications of the User, which this marks read.
async function inbox(db: Database, userId: number) {
	const { page } = await db.notifications.show(userId, firstPage);
	return page.items.map((notification) => `${notification.kind}${"actor" in notification ? ` ${notification.actor.username}` : ""}`).toSorted();
}

describe("A private Profile", () => {
	it("shares its Reviews with its User, their Followers and the Admins, and still counts them in the RatingAvg", async () => {
		const { client, db } = createTestDatabase();
		const admin = insertUser(client, "root_admin", "admin");
		const ada = insertUser(client, "ada");
		const bob = insertUser(client, "bob");
		const cleo = insertUser(client, "cleo");
		const grill = insertRestaurant(client, "Bosporus Grill", { status: "approved" });
		await db.follows.follow(ada.id, bob.username);
		const review = { id: await publish(db, bob.id, grill.id, "Garlic sauce worth the queue"), author: bob.username, restaurantId: grill.id, text: "Garlic sauce worth the queue" };
		const before = await whereShown(db, cleo.id, review);

		await db.users.setPrivacy(bob.id, bob.username, true);

		// [Profile, Review, Restaurant, Feed of everyone]. An Admin reads the Reviews to moderate them, not in the lists.
		expect({
			beforeForOthers: before,
			author: await whereShown(db, bob.id, review),
			follower: await whereShown(db, ada.id, review),
			other: await whereShown(db, cleo.id, review),
			visitor: await whereShown(db, null, review),
			admin: await whereShown(db, admin.id, review),
		}).toEqual({
			beforeForOthers: [true, true, true, true],
			author: [true, true, true, true],
			follower: [true, true, true, true],
			other: [false, false, false, false],
			visitor: [false, false, false, false],
			admin: [true, true, false, false],
		});
		expect(restaurantRow(client, grill.id)).toMatchObject({ ratingAvg: 8, reviewCount: 1 });
	});

	it("turns a Follow into a request that its User approves, and tells the one who asked", async () => {
		const { client, db } = createTestDatabase();
		const ada = insertUser(client, "ada");
		const bob = insertUser(client, "bob");
		await db.users.setPrivacy(bob.id, bob.username, true);
		const state = async () => ({
			adaFollows: usernames((await db.follows.listFollowing(ada.id, null, firstPage)).items),
			bobsRequests: usernames((await db.follows.listRequests(bob.id, bob.id, firstPage)).items),
			adaInbox: await inbox(db, ada.id),
			bobInbox: await inbox(db, bob.id),
		});

		await db.follows.follow(ada.id, bob.username);
		const asked = await state();
		await db.follows.approveRequest(bob.id, ada.username);

		expect({ asked, approved: await state() }).toEqual({
			asked: { adaFollows: [], bobsRequests: ["ada"], adaInbox: [], bobInbox: ["follow-request ada"] },
			// Bob approved Ada himself, so he is not told that she follows him.
			approved: { adaFollows: ["bob"], bobsRequests: [], adaInbox: ["follow-accepted bob"], bobInbox: [] },
		});
	});

	it("lets the one who asked take the request back, and its User decline it, which takes back the Notification", async () => {
		const { client, db } = createTestDatabase();
		const admin = insertUser(client, "root_admin", "admin");
		const bob = insertUser(client, "bob");
		const cleo = insertUser(client, "cleo");
		const dan = insertUser(client, "dan");
		const eve = insertUser(client, "eve");
		await db.users.setPrivacy(bob.id, bob.username, true);
		for (const user of [cleo, dan, eve]) await db.follows.follow(user.id, bob.username);

		await db.follows.unfollow(cleo.id, bob.username);
		await db.follows.removeFollower(bob.id, dan.username);
		// A banned user waits until the ban is lifted, out of sight.
		await db.users.ban(admin.id, eve.username);

		expect({
			requests: usernames((await db.follows.listRequests(bob.id, bob.id, firstPage)).items),
			count: (await db.users.findProfile(bob.username, bob.id))?.followRequestCount,
			followers: usernames((await db.follows.listFollowers(bob.id, null, firstPage)).items),
			inbox: await inbox(db, bob.id),
		}).toEqual({ requests: [], count: 0, followers: [], inbox: [] });
	});

	it("lets its User remove a Follower, who then no longer sees the Reviews nor may like them", async () => {
		const { client, db } = createTestDatabase();
		const ada = insertUser(client, "ada");
		const bob = insertUser(client, "bob");
		const grill = insertRestaurant(client, "Bosporus Grill", { status: "approved" });
		await db.follows.follow(ada.id, bob.username);
		const review = await publish(db, bob.id, grill.id, "Crisp bread");
		await db.users.setPrivacy(bob.id, bob.username, true);
		// Ada followed Bob while his Profile was public, so she follows him still, and asks for nothing.
		await db.follows.follow(ada.id, bob.username);
		const listedToAda = async () => (await db.reviews.listEveryone(ada.id, firstPage)).items.map((item) => item.id);
		const followed = await listedToAda();

		await db.follows.removeFollower(bob.id, ada.username);

		expect({ followed, removed: await listedToAda() }).toEqual({ followed: [review], removed: [] });
		expect(await db.reviews.like(ada.id, review)).toMatchObject({ problem: "not-found" });
		expect(await inbox(db, bob.id)).toEqual([]);
	});

	it("approves every request once it becomes public, and tells each one who asked", async () => {
		const { client, db } = createTestDatabase();
		const ada = insertUser(client, "ada");
		const bob = insertUser(client, "bob");
		const cleo = insertUser(client, "cleo");
		await db.users.setPrivacy(bob.id, bob.username, true);
		await db.follows.follow(ada.id, bob.username);
		await db.follows.follow(cleo.id, bob.username);

		await db.users.setPrivacy(bob.id, bob.username, false);

		// Bob approved the requests himself by making his Profile public, so he is not told that they follow him.
		expect({
			followers: usernames((await db.follows.listFollowers(bob.id, null, firstPage)).items),
			requests: usernames((await db.follows.listRequests(bob.id, bob.id, firstPage)).items),
			bobInbox: await inbox(db, bob.id),
			adaInbox: await inbox(db, ada.id),
			cleoInbox: await inbox(db, cleo.id),
		}).toEqual({ followers: ["ada", "cleo"], requests: [], bobInbox: [], adaInbox: ["follow-accepted bob"], cleoInbox: ["follow-accepted bob"] });
	});

	it("shows its User who waits to be approved, and the one who asked that they wait", async () => {
		const { client, db } = createTestDatabase();
		const ada = insertUser(client, "ada");
		const bob = insertUser(client, "bob");
		await db.users.setPrivacy(bob.id, bob.username, true);
		await db.follows.follow(ada.id, bob.username);
		const profileFor = async (userId: number, path = "/bob/profile") =>
			(await renderPage(ProfilePage, { db, session: await signIn(db, userId) }, path, { username: "bob" })).html;

		const asker = await profileFor(ada.id);
		const ownProfile = await profileFor(bob.id);
		const requests = await profileFor(bob.id, "/bob/profile?tab=requests");
		const askerOnRequests = await profileFor(ada.id, "/bob/profile?tab=requests");
		const notifications = (await renderPage(NotificationsPage, { db, session: await signIn(db, bob.id) }, "/notifications")).html;

		expect({
			asker: [asker.includes("Cancel request"), asker.includes("Only the followers of bob user see their reviews.")],
			ownProfile: [ownProfile.includes('href="/bob/profile?tab=requests"'), ownProfile.includes("Cancel request")],
			requests: [requests.includes("@ada"), requests.includes(">Approve<"), requests.includes(">Decline<")],
			// The tab of the requests is not there for anyone else, who sees the Reviews tab instead.
			askerOnRequests: [askerOnRequests.includes(">Approve<"), askerOnRequests.includes("Only the followers of bob user see their reviews.")],
			notifications: [notifications.includes("asked to follow you"), notifications.includes(">Approve<")],
		}).toEqual({
			asker: [true, true],
			ownProfile: [true, false],
			requests: [true, true, true],
			askerOnRequests: [false, true],
			notifications: [true, true],
		});
	});

	it("tells only its followers when the User of a private Profile last reviewed, also in the order of people", async () => {
		const { client, db } = createTestDatabase();
		const ada = insertUser(client, "ada");
		const bob = insertUser(client, "bob");
		const cleo = insertUser(client, "cleo");
		const grill = insertRestaurant(client, "Grill", { status: "approved" });
		insertReview(client, ada.id, grill.id, 8, new Date("2026-01-01T00:00:00Z"));
		insertReview(client, bob.id, grill.id, 8, new Date("2026-06-01T00:00:00Z"));
		await db.users.setPrivacy(bob.id, bob.username, true);
		await db.follows.follow(cleo.id, bob.username);
		await db.follows.approveRequest(bob.id, cleo.username);
		// The page holds one person, so the address of the next page names when that person last reviewed.
		const latestFirst = async (viewerId: number | null) => {
			const page = await db.users.search("", "latest-review", viewerId, { limit: 1, cursor: undefined });
			return [page.items.map((person) => person.username), page.next?.after];
		};

		const at = (date: string) => new Date(date).getTime() / 1000;
		expect({ visitor: await latestFirst(null), stranger: await latestFirst(ada.id), follower: await latestFirst(cleo.id) }).toEqual({
			visitor: [["ada"], `${at("2026-01-01T00:00:00Z")}_${ada.id}`],
			stranger: [["ada"], `${at("2026-01-01T00:00:00Z")}_${ada.id}`],
			follower: [["bob"], `${at("2026-06-01T00:00:00Z")}_${bob.id}`],
		});
	});
});
