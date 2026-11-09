import { beforeAll, describe, expect, it } from "vitest";
import { clusterCellSize, exploreMapSize } from "@src/data/map";
import { isProblem } from "@src/db/problem";
import { viewport } from "@src/map/viewport";
import type { PageRequest } from "@src/pagination";
import { openLargeDatabase, type Measured, type MeasuredDatabase } from "@src/tests/durable-database";
import type { PlannedStatement } from "@src/tests/durable-database-worker";

// The free plan of Cloudflare stops the database for the rest of the day when it has read 5 million rows, so each
// call of the database is measured as Cloudflare bills it.
//
// Every call runs in two databases: one, and one with four times as much of the rest of the site. A call reads the
// same rows in both, so the size of the site does not make a page cost more. A call that cannot says why.
//
// Every statement is planned too. None reads a whole table, unless the call says why. A statement that walks an
// index in order is not counted, since its limit stops it: the rows it reads are what the first check measures.

const page: PageRequest = { limit: 10, cursor: undefined };
// The search page shows the first 5 of each kind.
const preview: PageRequest = { limit: 5, cursor: undefined };
// Odense, as GeoNames numbers it, the City of the CitySearch of the databases.
const odenseId = 2615876;

interface Call {
	measure: (db: MeasuredDatabase) => Promise<Measured<unknown>>;
	// The most rows it may read, in the larger database.
	budget: number;
	// Why it reads more rows as the site grows.
	grows?: string;
	// Why a statement of it reads a whole table.
	scansTable?: string;
	// Why it finds nothing in the databases, which call it as the site does.
	findsNothing?: string;
}

// The tables a statement reads from start to end: a SCAN without an index, of a table or of its alias, but not of
// a subquery, which reads only the rows the subquery found.
function tableScans({ plan }: PlannedStatement): string[] {
	const lines = plan.map((line) => line.trim());
	const subqueries = new Set(lines.flatMap((line) => /^(?:CO-ROUTINE|MATERIALIZE) (.+)$/.exec(line)?.[1] ?? []));
	return lines.filter((line) => {
		const target = /^SCAN (.+)$/.exec(line)?.[1];
		return (
			target !== undefined && !target.includes(" USING ") && !subqueries.has(target) && !target.startsWith("(subquery") && target !== "CONSTANT ROW"
		);
	});
}

function itemCount(value: unknown): number | undefined {
	if (Array.isArray(value)) return value.length;
	if (typeof value !== "object" || value === null) return undefined;
	if ("items" in value && Array.isArray(value.items)) return value.items.length;
	if ("page" in value) return itemCount(value.page);
	return undefined;
}

async function expectCheap({ measure, budget, grows, scansTable, findsNothing }: Call, small: MeasuredDatabase, large: MeasuredDatabase) {
	const inSmall = await measure(small);
	const inLarge = await measure(large);
	const scans = inLarge.statements.flatMap(tableScans);
	const found = inLarge.value !== undefined && inLarge.value !== null && itemCount(inLarge.value) !== 0;

	// A call that was refused or found nothing would read few rows, and prove nothing.
	expect(isProblem(inLarge.value), "was refused").toBe(false);
	expect(found, findsNothing ? `finds nothing: ${findsNothing}` : "finds something").toBe(!findsNothing);
	expect(inLarge.rowsRead, "reads more rows than its budget").toBeLessThanOrEqual(budget);
	if (grows) expect(inLarge.rowsRead, `grows with the site: ${grows}`).toBeGreaterThan(inSmall.rowsRead);
	else expect(inLarge.rowsRead, "reads more rows as the site grows").toBe(inSmall.rowsRead);
	if (scansTable) expect(scans, `scans a table: ${scansTable}`).not.toEqual([]);
	else expect(scans, "scans a whole table").toEqual([]);
}

// The calls in a new pair of databases, one after the other, so that a write finds what the writes before it left.
function describeCalls(title: string, calls: Record<string, Call>) {
	describe(title, () => {
		let small: MeasuredDatabase;
		let large: MeasuredDatabase;
		beforeAll(async () => {
			[small, large] = await Promise.all([openLargeDatabase(1), openLargeDatabase(4)]);
		});

		for (const [name, call] of Object.entries(calls)) it(name, () => expectCheap(call, small, large));
	});
}

function mapOf(db: MeasuredDatabase, zoom: number) {
	const map = viewport(db.subjects.center, zoom, exploreMapSize);
	return db.measure("restaurants", "listClusters", map.bounds, map.clusterGrid(clusterCellSize));
}

describeCalls("the rows each call of the database reads to show a page", {
	"sessions.findActiveWithUser, on every page a User opens": {
		measure: (db) => db.measure("sessions", "findActiveWithUser", db.subjects.sessionId),
		budget: 30,
	},
	"reviews.listEveryone, the Feed of a Visitor": {
		measure: (db) => db.measure("reviews", "listEveryone", null, page),
		budget: 150,
	},
	"reviews.listEveryone, its next page": {
		measure: async (db) => {
			const first = await db.measure("reviews", "listEveryone", null, page);
			return db.measure("reviews", "listEveryone", null, { ...page, cursor: first.value.next });
		},
		budget: 170,
	},
	"reviews.listEveryone, for a User": {
		measure: (db) => db.measure("reviews", "listEveryone", db.subjects.viewerId, page),
		budget: 180,
	},
	"reviews.listFollowed, the Feed of a User": {
		measure: (db) => db.measure("reviews", "listFollowed", db.subjects.viewerId, page),
		budget: 200,
	},
	"reviews.listByRestaurant": {
		measure: (db) => db.measure("reviews", "listByRestaurant", db.subjects.restaurantId, null, page),
		budget: 150,
	},
	"reviews.listPublicByAuthor": {
		measure: (db) => db.measure("reviews", "listPublicByAuthor", db.subjects.authorId, null, page),
		budget: 150,
	},
	"reviews.listAllByAuthor, on the own Profile": {
		measure: (db) => db.measure("reviews", "listAllByAuthor", db.subjects.authorId, db.subjects.authorId, page),
		budget: 100,
	},
	"reviews.findById": {
		measure: (db) => db.measure("reviews", "findById", db.subjects.reviewId, null),
		budget: 15,
	},
	"restaurants.findById": {
		measure: (db) => db.measure("restaurants", "findById", db.subjects.restaurantId, db.subjects.viewerId),
		budget: 10,
	},
	"restaurants.list, the best rated on the search page": {
		measure: (db) => db.measure("restaurants", "list", "", "top-rated", preview),
		budget: 15,
	},
	"restaurants.list, the most reviewed": {
		measure: (db) => db.measure("restaurants", "list", "", "popular", page),
		budget: 25,
	},
	"restaurants.list, the newest": {
		measure: (db) => db.measure("restaurants", "list", "", "newest", page),
		budget: 25,
	},
	"restaurants.list, with a search": {
		measure: (db) => db.measure("restaurants", "list", "kebab", "top-rated", page),
		budget: 500,
		grows: "a search reads the approved restaurants, the best rated first, until it has found a page of them",
	},
	"restaurants.list, with a search few restaurants match": {
		measure: (db) => db.measure("restaurants", "list", "funen kebab 2", "top-rated", page),
		budget: 2500,
		grows: "a search reads the approved restaurants, the best rated first, until it has found a page of them",
	},
	"restaurants.listClusters, the map of a city": {
		measure: (db) => mapOf(db, 13),
		budget: 200,
	},
	"restaurants.listClusters, the map of a continent": {
		measure: (db) => mapOf(db, 4),
		budget: 10_000,
		grows: "the map of a continent shows most restaurants, and reads where each of them is",
	},
	"restaurants.listSuggestedBy": {
		measure: (db) => db.measure("restaurants", "listSuggestedBy", db.subjects.viewerId, page),
		budget: 25,
	},
	"users.search, the people with most reviews on the search page": {
		measure: (db) => db.measure("users", "search", "", "most-reviews", null, preview),
		budget: 10,
	},
	"users.search, the people who reviewed last": {
		measure: (db) => db.measure("users", "search", "", "latest-review", db.subjects.viewerId, page),
		budget: 50,
	},
	"users.search, with a search": {
		measure: (db) => db.measure("users", "search", "friend", "most-reviews", null, page),
		budget: 600,
		grows: "a search reads the people, those with most reviews first, until it has found a page of them",
	},
	"users.search, with a search few people match": {
		measure: (db) => db.measure("users", "search", "hidden", "most-reviews", null, page),
		budget: 500,
		grows: "a search reads the people, those with most reviews first, until it has found a page of them",
	},
	"users.findProfile": {
		measure: (db) => db.measure("users", "findProfile", "author", null),
		budget: 80,
	},
	"users.findByUsername": {
		measure: (db) => db.measure("users", "findByUsername", "author"),
		budget: 5,
	},
	"collections.list, the Favorites": {
		measure: (db) => db.measure("collections", "list", db.subjects.viewerId, "favorites", page),
		budget: 50,
	},
	"collections.list, the BucketList": {
		measure: (db) => db.measure("collections", "list", db.subjects.viewerId, "bucketList", page),
		budget: 50,
	},
	"follows.listFollowers": {
		measure: (db) => db.measure("follows", "listFollowers", db.subjects.authorId, null, page),
		budget: 60,
	},
	"follows.listFollowing": {
		measure: (db) => db.measure("follows", "listFollowing", db.subjects.viewerId, null, page),
		budget: 60,
	},
	"follows.listRequests": {
		measure: (db) => db.measure("follows", "listRequests", db.subjects.privateId, db.subjects.privateId, page),
		budget: 40,
	},
	"cities.search": {
		measure: (db) => db.measure("cities", "search", "odense", 5),
		budget: 2,
	},
	"suggestionQueue.listBy": {
		measure: (db) => db.measure("suggestionQueue", "listBy", db.subjects.viewerId),
		budget: 10,
	},
	"history.listBySession": {
		measure: (db) => db.measure("history", "listBySession", db.subjects.sessionId, page),
		budget: 15,
	},
	"sessions.listActive": {
		measure: (db) => db.measure("sessions", "listActive", db.subjects.viewerId),
		budget: 40,
	},
	"sessions.findActive": {
		measure: (db) => db.measure("sessions", "findActive", db.subjects.sessionId, db.subjects.viewerId),
		budget: 40,
	},
	"personalData.findByUser, the download of all data of a User": {
		measure: (db) => db.measure("personalData", "findByUser", db.subjects.viewerId),
		budget: 400,
	},
});

describeCalls("the rows each call of the database reads for the Admins", {
	"users.list": {
		measure: (db) => db.measure("users", "list", "", "all", page),
		budget: 500,
		grows: "the list tells how many users match, which counts them",
		scansTable: "it counts the users that match",
	},
	"users.countByFilter": {
		measure: (db) => db.measure("users", "countByFilter"),
		budget: 1500,
		grows: "it counts the users, the Admins and the banned",
		scansTable: "it counts the users",
	},
	"restaurants.countByStatus": {
		measure: (db) => db.measure("restaurants", "countByStatus"),
		budget: 1800,
		grows: "it counts the restaurants of each status",
	},
	"restaurants.listByStatus": {
		measure: (db) => db.measure("restaurants", "listByStatus", "pending", page),
		budget: 30,
	},
	"cities.status": {
		measure: (db) => db.measure("cities", "status"),
		budget: 5,
		scansTable: "it reads the updates of the CityList from the newest, and stops at the first it needs",
	},
	"citySearches.list": {
		measure: (db) => db.measure("citySearches", "list", page),
		budget: 30,
		scansTable: "it reads the CitySearches from the newest, and stops when the page is full",
	},
	"citySearches.findById": {
		measure: (db) => db.measure("citySearches", "findById", db.subjects.citySearchId),
		budget: 40,
	},
	"citySearches.listRunningCityIds": {
		measure: (db) => db.measure("citySearches", "listRunningCityIds", [odenseId]),
		budget: 5,
		findsNothing: "the CitySearch of Odense has finished",
	},
});

describeCalls("the rows each call of the database reads for the background work", {
	"suggestionQueue.next": {
		measure: (db) => db.measure("suggestionQueue", "next"),
		budget: 5,
	},
	"citySearches.nextSearch": {
		measure: (db) => db.measure("citySearches", "nextSearch"),
		budget: 5,
		findsNothing: "no CitySearch waits",
	},
	"citySearches.nextCandidate": {
		measure: (db) => db.measure("citySearches", "nextCandidate"),
		budget: 5,
		findsNothing: "no place of a CitySearch waits",
	},
	"cities.nextUpdate": {
		measure: (db) => db.measure("cities", "nextUpdate"),
		budget: 5,
		findsNothing: "no update of the CityList waits",
	},
	"retention.purge, each hour once the expired data is gone": {
		measure: async (db) => {
			await db.measure("retention", "purge", new Date());
			return db.measure("retention", "purge", new Date());
		},
		budget: 300,
		grows: "it reads the links that left the SuggestionQueue, which stay for 30 days",
	},
});

const review = { rating: 8, description: "Crisp." };

// The writes run in this order, each on what the ones before left.
describeCalls("the rows each write to the database reads", {
	"history.record, after every page a User opens": {
		measure: (db) =>
			db.measure("history", "record", {
				sessionId: db.subjects.sessionId,
				requestedAt: new Date(),
				method: "GET",
				route: "/feed",
				path: "/feed",
				action: null,
				status: 200,
				prefetched: false,
			}),
		budget: 5,
		findsNothing: "it returns nothing",
	},
	"sessions.setActionData": {
		measure: (db) => db.measure("sessions", "setActionData", db.subjects.sessionId, null),
		budget: 5,
		findsNothing: "it returns nothing",
	},
	"sessions.setLastVerifiedAt": {
		measure: (db) => db.measure("sessions", "setLastVerifiedAt", db.subjects.sessionId, new Date()),
		budget: 5,
		findsNothing: "it returns nothing",
	},
	"sessions.setTheme": {
		measure: (db) => db.measure("sessions", "setTheme", db.subjects.sessionId, "dark"),
		budget: 5,
		findsNothing: "it returns nothing",
	},
	"notifications.show, which marks them read": {
		measure: (db) => db.measure("notifications", "show", db.subjects.viewerId, page),
		budget: 90,
	},
	"reviews.create": {
		measure: (db) => db.measure("reviews", "create", db.subjects.viewerId, db.subjects.restaurantId, review, []),
		budget: 200,
	},
	"reviews.update": {
		measure: (db) => db.measure("reviews", "update", db.subjects.authorId, db.subjects.reviewId, { ...review, addPictures: [], removePictureIds: [] }),
		budget: 200,
	},
	"reviews.like": {
		measure: (db) => db.measure("reviews", "like", db.subjects.viewerId, db.subjects.privateReviewId),
		budget: 40,
	},
	"reviews.unlike": {
		measure: (db) => db.measure("reviews", "unlike", db.subjects.viewerId, db.subjects.privateReviewId),
		budget: 40,
	},
	"reviews.delete": {
		measure: (db) => db.measure("reviews", "delete", db.subjects.friendId, db.subjects.friendReviewId),
		budget: 200,
	},
	"collections.add": {
		measure: (db) => db.measure("collections", "add", db.subjects.authorId, db.subjects.restaurantId, "favorites"),
		budget: 10,
	},
	"collections.remove": {
		measure: (db) => db.measure("collections", "remove", db.subjects.authorId, db.subjects.restaurantId, "favorites"),
		budget: 10,
		findsNothing: "it returns nothing",
	},
	"follows.follow, a private Profile": {
		measure: (db) => db.measure("follows", "follow", db.subjects.authorId, "hidden"),
		budget: 20,
	},
	"follows.approveRequest": {
		measure: (db) => db.measure("follows", "approveRequest", db.subjects.privateId, "author"),
		budget: 30,
	},
	"follows.removeFollower": {
		measure: (db) => db.measure("follows", "removeFollower", db.subjects.privateId, "author"),
		budget: 30,
	},
	"follows.unfollow": {
		measure: (db) => db.measure("follows", "unfollow", db.subjects.viewerId, "friend_1"),
		budget: 70,
	},
	"users.updateProfile": {
		measure: (db) => db.measure("users", "updateProfile", db.subjects.viewerId, "viewer", { fullname: "Viewer", username: "viewer", pronoun: null, bio: "Kebab." }),
		budget: 10,
	},
	"users.setLocation": {
		measure: (db) => db.measure("users", "setLocation", db.subjects.viewerId, "viewer", db.subjects.center),
		budget: 10,
	},
	"users.setNotificationPreferences": {
		measure: (db) =>
			db.measure("users", "setNotificationPreferences", db.subjects.viewerId, "viewer", {
				followNotifications: true,
				likeNotifications: false,
				suggestionNotifications: true,
			}),
		budget: 10,
	},
	"users.setPrivacy": {
		measure: (db) => db.measure("users", "setPrivacy", db.subjects.authorId, "author", true),
		budget: 100,
	},
	"restaurants.decide": {
		measure: (db) => db.measure("restaurants", "decide", db.subjects.adminId, [db.subjects.pendingRestaurantId], "approved"),
		budget: 20,
	},
	"users.setRole": {
		measure: (db) => db.measure("users", "setRole", db.subjects.adminId, "author", "admin"),
		budget: 10,
	},
	"users.ban": {
		measure: (db) => db.measure("users", "ban", db.subjects.adminId, "friend_2"),
		budget: 160,
	},
	"users.unban": {
		measure: (db) => db.measure("users", "unban", db.subjects.adminId, "friend_2"),
		budget: 160,
	},
	"users.signOutEverywhere": {
		measure: (db) => db.measure("users", "signOutEverywhere", db.subjects.viewerId, "viewer"),
		budget: 120,
	},
	"suggestionQueue.queue": {
		measure: (db) => db.measure("suggestionQueue", "queue", db.subjects.authorId, "https://maps.app.goo.gl/new"),
		budget: 15,
	},
	"cities.requestUpdate": {
		measure: (db) => db.measure("cities", "requestUpdate", db.subjects.adminId),
		budget: 20,
	},
	"citySearches.start": {
		measure: (db) => db.measure("citySearches", "start", db.subjects.adminId, odenseId, "Odense"),
		budget: 20,
	},
	"accounts.signIn, with a new account": {
		measure: (db) =>
			db.measure("accounts", "signIn", { providerId: "google", accountId: "new-account", fullname: "New Person", email: "new@example.com", emailVerified: true }),
		budget: 30,
	},
	"users.delete": {
		measure: (db) => db.measure("users", "delete", db.subjects.friendId, "friend_0"),
		budget: 400,
	},
});
