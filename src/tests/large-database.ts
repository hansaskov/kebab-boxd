import { refreshAuthorStats, refreshLikeCounts, refreshRestaurantStats } from "@src/db/cached-stats";
import type { Client, Transaction } from "@src/db/client";
import { chunks, durableSqliteLimits } from "@src/db/limits";
import * as s from "@src/db/schema";
import type { CityGroupRow } from "@src/db/schema";

// A database the size of a busy Kebab Boxd, to count the rows each call reads in.
//
// It has two parts. The subjects are the users, restaurants and reviews the tests open, the same in every database
// this makes. The background is the rest of the site, and grows with the scale. The background was written before
// the subjects, so the first page of every list shows subjects, whatever the scale. A call that reads the same rows
// at every scale reads only what it shows, and the size of the site does not make it cost more.

const day = 24 * 60 * 60 * 1000;
// Before the subjects, which are written on the days after it.
const backgroundEnd = Date.UTC(2026, 0, 1);
const subjectStart = Date.UTC(2026, 1, 1);

// The same numbers in every run, so every run measures the same database.
function randomNumbers(seed: number) {
	let state = seed;
	return () => {
		state = (state * 1_103_515_245 + 12_345) % 2_147_483_648;
		return state / 2_147_483_648;
	};
}

function backgroundTime(random: () => number) {
	return new Date(backgroundEnd - Math.floor(random() * 365 * day));
}

function subjectTime(order: number) {
	return new Date(subjectStart + order * 60_000);
}

function insertUser(tx: Transaction, username: string, values: Partial<typeof s.users.$inferInsert> = {}) {
	return tx
		.insert(s.users)
		.values({ fullname: `${username} user`, username, email: `${username}@example.com`, ...values })
		.returning({ id: s.users.id })
		.get().id;
}

function insertRestaurant(
	tx: Transaction,
	name: string,
	{ latitude, longitude, city, ...values }: { latitude: number; longitude: number; city: string } & Partial<typeof s.restaurants.$inferInsert>,
) {
	const location = tx
		.insert(s.locations)
		.values({ addressLine1: `${name} street 1`, city, postalCode: "5000", country: "Denmark", latitude, longitude })
		.returning({ id: s.locations.id })
		.get();
	return tx
		.insert(s.restaurants)
		.values({ name, locationId: location.id, ...values })
		.returning({ id: s.restaurants.id })
		.get().id;
}

function insertReview(tx: Transaction, authorId: number, restaurantId: number, rating: number, createdAt: Date) {
	return tx
		.insert(s.reviews)
		.values({ authorId, restaurantId, rating, description: "Crisp bread and a fair price.", createdAt, updatedAt: createdAt })
		.returning({ id: s.reviews.id })
		.get().id;
}

// The rest of the site, far from Funen so that it is not on a map of the subjects.
function insertBackground(tx: Transaction, scale: number) {
	const random = randomNumbers(scale);
	const pick = <T>(items: readonly T[]) => items[Math.floor(random() * items.length)]!;

	const userIds = Array.from({ length: 100 * scale }, (_, i) =>
		insertUser(tx, `someone_${i}`, {
			isPrivate: i % 10 === 0,
			bannedAt: i % 50 === 1 ? new Date(backgroundEnd) : null,
			createdAt: backgroundTime(random),
		}),
	);

	const restaurants = Array.from({ length: 400 * scale }, (_, i) => {
		const status = i % 10 < 6 ? "approved" : i % 10 < 9 ? "pending" : "rejected";
		const id = insertRestaurant(tx, `Grill ${i}`, {
			// Between Spain and Poland, far south of Funen.
			latitude: 40 + random() * 12,
			longitude: -5 + random() * 25,
			city: `Town ${i % 97}`,
			status,
			suggestedBy: i % 3 === 0 ? pick(userIds) : null,
			createdAt: backgroundTime(random),
		});
		return { id, status };
	});
	const approvedIds = restaurants.filter((restaurant) => restaurant.status === "approved").map((restaurant) => restaurant.id);

	const reviewIds: number[] = [];
	for (let i = 0; i < 1000 * scale; i++) {
		const authorId = pick(userIds);
		const restaurantId = pick(approvedIds);
		// Some authors come back to a restaurant, so that their older reviews leave the ReviewWindow.
		const visits = i % 20 === 0 ? 5 : 1;
		for (let visit = 0; visit < visits; visit++) {
			reviewIds.push(insertReview(tx, authorId, restaurantId, 2 + Math.floor(random() * 9), backgroundTime(random)));
		}
	}

	const pairs = <A, B>(count: number, left: readonly A[], right: readonly B[]) => {
		const seen = new Map<string, [A, B]>();
		while (seen.size < count) {
			const pair: [A, B] = [pick(left), pick(right)];
			seen.set(`${String(pair[0])}:${String(pair[1])}`, pair);
		}
		return [...seen.values()];
	};

	for (const [userId, reviewId] of pairs(1000 * scale, userIds, reviewIds)) {
		tx.insert(s.likes).values({ userId, reviewId, createdAt: backgroundTime(random) }).run();
	}
	for (const [followerId, followingId] of pairs(300 * scale, userIds, userIds)) {
		if (followerId !== followingId) tx.insert(s.followers).values({ followerId, followingId, createdAt: backgroundTime(random) }).run();
	}
	for (const table of [s.favorites, s.bucketList]) {
		for (const [userId, restaurantId] of pairs(300 * scale, userIds, approvedIds)) {
			tx.insert(table).values({ userId, restaurantId, createdAt: backgroundTime(random) }).run();
		}
	}
	for (let i = 0; i < 300 * scale; i++) {
		const [recipientId, actorId] = [pick(userIds), pick(userIds)];
		if (recipientId === actorId) continue;
		tx.insert(s.notifications)
			.values({ recipientId, actorId, kind: "follow", createdAt: backgroundTime(random), readAt: i % 2 ? backgroundTime(random) : null })
			.onConflictDoNothing()
			.run();
	}
	for (let i = 0; i < 100 * scale; i++) {
		const sessionId = `background-session-${i}`;
		tx.insert(s.sessions)
			.values({ id: sessionId, userId: pick(userIds), secretHash: Buffer.alloc(32), lastVerifiedAt: backgroundTime(random) })
			.run();
		for (let page = 0; page < 10; page++) {
			tx.insert(s.history)
				.values({ sessionId, requestedAt: backgroundTime(random), method: "GET", route: "/feed", path: "/feed", status: 200 })
				.run();
		}
	}
	for (let i = 0; i < 50 * scale; i++) {
		tx.insert(s.suggestionQueue)
			.values({ userId: pick(userIds), link: `https://maps.app.goo.gl/background${i}`, status: i % 2 ? "not-a-place" : "failed", createdAt: backgroundTime(random) })
			.run();
	}
	for (let i = 0; i < 10 * scale; i++) {
		const searchId = tx
			.insert(s.citySearches)
			.values({ cityId: 1000 + i, name: `Town ${i}`, countryCode: "DE", latitude: 50, longitude: 10, population: 50_000, status: "finished", createdAt: backgroundTime(random) })
			.returning({ id: s.citySearches.id })
			.get().id;
		for (let event = 0; event < 10; event++) {
			tx.insert(s.citySearchEvents).values({ citySearchId: searchId, message: `Asked server ${event}.` }).run();
		}
	}

}

// Odense, where the default map starts, and the places around it.
const odense = { latitude: 55.3959, longitude: 10.3883 };

function insertSubjects(tx: Transaction) {
	let order = 0;
	const next = () => subjectTime(order++);

	const adminId = insertUser(tx, "admin", { role: "admin", createdAt: next() });
	const viewerId = insertUser(tx, "viewer", { createdAt: next(), latitude: odense.latitude, longitude: odense.longitude });
	const authorId = insertUser(tx, "author", { createdAt: next() });
	const privateId = insertUser(tx, "hidden", { isPrivate: true, createdAt: next() });
	const friendIds = Array.from({ length: 12 }, (_, i) => insertUser(tx, `friend_${i}`, { createdAt: next() }));

	// 24 approved restaurants on Funen, and some that wait or were rejected.
	const restaurantIds = Array.from({ length: 24 }, (_, i) =>
		insertRestaurant(tx, `Funen Kebab ${i}`, {
			latitude: odense.latitude - 0.03 + (i % 6) * 0.012,
			longitude: odense.longitude - 0.05 + Math.floor(i / 6) * 0.025,
			city: "Odense",
			status: "approved",
			createdAt: next(),
		}),
	);
	const restaurantId = restaurantIds[0]!;
	const suggestedIds = Array.from({ length: 12 }, (_, i) =>
		insertRestaurant(tx, `Suggested Kebab ${i}`, {
			latitude: odense.latitude + 0.02,
			longitude: odense.longitude + 0.01 * i,
			city: "Odense",
			status: i < 10 ? "pending" : "rejected",
			suggestedBy: viewerId,
			createdAt: next(),
		}),
	);

	// The author reviewed many restaurants, and one of them so often that the oldest reviews left the ReviewWindow.
	const authorReviewIds = restaurantIds.slice(0, 12).map((id, i) => insertReview(tx, authorId, id, 6 + (i % 5), next()));
	for (let visit = 0; visit < 4; visit++) authorReviewIds.push(insertReview(tx, authorId, restaurantIds[1]!, 8, next()));
	const privateReviewIds = restaurantIds.slice(0, 12).map((id) => insertReview(tx, privateId, id, 7, next()));
	const friendReviewIds = friendIds.flatMap((friendId, i) => [
		insertReview(tx, friendId, restaurantId, 4 + (i % 7), next()),
		insertReview(tx, friendId, restaurantIds[2 + i]!, 8, next()),
	]);

	// The viewer follows the author, the private user and the friends. The friends follow the author.
	for (const followingId of [authorId, privateId, ...friendIds]) {
		tx.insert(s.followers).values({ followerId: viewerId, followingId, createdAt: next() }).run();
	}
	for (const friendId of friendIds) {
		tx.insert(s.followers).values({ followerId: friendId, followingId: authorId, createdAt: next() }).run();
		tx.insert(s.followers).values({ followerId: authorId, followingId: friendId, createdAt: next() }).run();
		tx.insert(s.followRequests).values({ followerId: friendId, followingId: privateId, createdAt: next() }).run();
	}

	for (const reviewId of [...authorReviewIds, ...friendReviewIds]) {
		tx.insert(s.likes).values({ userId: viewerId, reviewId, createdAt: next() }).run();
	}
	for (const table of [s.favorites, s.bucketList]) {
		for (const id of restaurantIds.slice(0, 15)) tx.insert(table).values({ userId: viewerId, restaurantId: id, createdAt: next() }).run();
	}

	// Notifications of the viewer, half of them read.
	friendIds.forEach((actorId, i) => {
		tx.insert(s.notifications)
			.values({ recipientId: viewerId, actorId, kind: "follow", createdAt: next(), readAt: i % 2 ? next() : null })
			.run();
	});
	friendReviewIds.forEach((reviewId, i) => {
		tx.insert(s.notifications)
			.values({ recipientId: authorId, actorId: viewerId, reviewId, kind: "like", createdAt: next(), readAt: i % 2 ? next() : null })
			.onConflictDoNothing()
			.run();
	});

	const sessionId = "viewer-session";
	tx.insert(s.sessions).values({ id: sessionId, userId: viewerId, secretHash: Buffer.alloc(32), lastVerifiedAt: new Date() }).run();
	for (let page = 0; page < 30; page++) {
		tx.insert(s.history).values({ sessionId, requestedAt: next(), method: "GET", route: "/feed", path: "/feed", status: 200 }).run();
	}
	for (let i = 0; i < 4; i++) {
		tx.insert(s.suggestionQueue)
			.values({ userId: viewerId, link: `https://maps.app.goo.gl/viewer${i}`, status: i === 0 ? "duplicate" : "queued", duplicateId: i === 0 ? restaurantId : null, createdAt: next() })
			.run();
	}

	const odenseRow: CityGroupRow = [2615876, "Odense", "South Denmark", "DK", odense.latitude, odense.longitude, 180_863, ["odense"]];
	tx.insert(s.cityGroups).values({ prefix: "od", cities: JSON.stringify([odenseRow]) }).run();
	tx.insert(s.cityListUpdates).values({ requestedBy: adminId, status: "finished", cityCount: 170_000, createdAt: next() }).run();
	const citySearchId = tx
		.insert(s.citySearches)
		.values({ startedBy: adminId, cityId: odenseRow[0], name: "Odense", countryCode: "DK", ...odense, population: odenseRow[6], status: "finished", createdAt: next() })
		.returning({ id: s.citySearches.id })
		.get().id;
	for (let event = 0; event < 20; event++) {
		tx.insert(s.citySearchEvents).values({ citySearchId, message: `Asked server ${event}.`, createdAt: next() }).run();
	}
	// The search approved what it found, and an Admin rejected some of it later. They are in the north of the city,
	// off the map of its middle, which stays as the budgets of the map were set for.
	for (let i = 0; i < 4; i++) {
		insertRestaurant(tx, `Found Kebab ${i}`, {
			latitude: odense.latitude + 0.045,
			longitude: odense.longitude + 0.01 * i,
			city: "Odense",
			status: i < 3 ? "approved" : "rejected",
			osmId: `node/${i + 1}`,
			citySearchId,
			createdAt: next(),
		});
	}

	return {
		adminId,
		viewerId,
		authorId,
		privateId,
		friendId: friendIds[0]!,
		sessionId,
		restaurantId,
		pendingRestaurantId: suggestedIds[0]!,
		reviewId: authorReviewIds[0]!,
		friendReviewId: friendReviewIds[0]!,
		privateReviewId: privateReviewIds[0]!,
		citySearchId,
		center: odense,
	};
}

export type LargeDatabase = ReturnType<typeof insertSubjects>;

// Fills an empty database: the background at the scale, then the subjects.
export async function fillLargeDatabase(client: Client, scale: number): Promise<LargeDatabase> {
	return client.transaction((tx) => {
		insertBackground(tx, scale);
		const subjects = insertSubjects(tx);
		const idsOf = (table: typeof s.restaurants | typeof s.reviews | typeof s.users) => tx.select({ id: table.id }).from(table).all().map((row) => row.id);
		for (const ids of chunks(idsOf(s.restaurants), durableSqliteLimits.variableNumber / 2)) refreshRestaurantStats(tx, ids);
		for (const ids of chunks(idsOf(s.reviews), durableSqliteLimits.variableNumber / 2)) refreshLikeCounts(tx, ids);
		for (const ids of chunks(idsOf(s.users), durableSqliteLimits.variableNumber / 2)) refreshAuthorStats(tx, ids);
		return subjects;
	});
}
