import { drizzle } from "drizzle-orm/node-sqlite";
import { migrate } from "drizzle-orm/node-sqlite/migrator";
import { onTestFinished } from "vitest";
import { createSession, findSession } from "@src/auth/session";
import { createDatabase } from "@src/db";
import { refreshAuthorStats } from "@src/db/cached-stats";
import type { Database } from "@src/db";
import type { Client } from "@src/db/client";
import { relations } from "@src/db/relations";
import { durableSqliteLimits } from "@src/db/limits";
import { isProblem } from "@src/db/problem";
import * as s from "@src/db/schema";
import type { PageRequest } from "@src/pagination";
import { createPictureStore } from "@src/pictures/store";
import { images, picturesBucket, removeAllPictures } from "@src/tests/cloudflare";

export const firstPage: PageRequest = { limit: 10, cursor: undefined };

// A new, empty database for one test, in memory, with the limits of SQLite in a Durable Object. The pictures
// it stores are removed when the test ends.
export function createTestDatabase() {
	const client = drizzle(":memory:", { relations });
	Object.assign(client.$client.limits, durableSqliteLimits);
	migrate(client, { migrationsFolder: ".drizzle" });
	onTestFinished(removeAllPictures);
	return { client, db: createDatabase(client, createPictureStore(picturesBucket, images)) };
}

export function insertUser(client: Client, username: string, role: "user" | "admin" = "user") {
	return client
		.insert(s.users)
		.values({ fullname: `${username} user`, username, email: `${username}@example.com`, role })
		.returning()
		.get();
}

export async function signIn(db: Database, userId: number) {
	const session = await findSession(db, (await createSession(db, userId)).token);
	if (!session) throw new Error(`User ${userId} could not sign in.`);
	return session;
}

export function insertRestaurant(
	client: Client,
	name: string,
	{
		suggestedBy = null,
		status = "pending",
		city = "Odense",
		latitude = 55.4,
		longitude = 10.39,
	}: Partial<Pick<s.NewRestaurant, "suggestedBy" | "status"> & Pick<s.NewLocation, "city" | "latitude" | "longitude">> = {},
) {
	const location = client.insert(s.locations).values({ city, latitude, longitude }).returning().get();
	return client.insert(s.restaurants).values({ name, locationId: location.id, suggestedBy, status }).returning().get();
}

export function restaurantRow(client: Client, id: number) {
	return client.query.restaurants.findFirst({ where: { id } }).sync();
}

// Writes the row directly, so the test can choose when it was written. Leaves the cached stats alone.
export function insertReview(client: Client, authorId: number, restaurantId: number, rating: number, createdAt = new Date()) {
	return client.insert(s.reviews).values({ authorId, restaurantId, rating, createdAt }).returning().get();
}

// Brings the cached review stats of the users up to date, after insertReview has left them alone.
export function refreshAuthorStatsOf(client: Client, userIds: number[]) {
	client.transaction((tx) => refreshAuthorStats(tx, userIds));
}

// Publishes a review the way a user does, so the cached rating of the restaurant follows.
export async function writeReview(db: Database, authorId: number, restaurantId: number, rating: number, files: File[] = []) {
	const result = await db.reviews.create(authorId, restaurantId, { rating, description: null }, files);
	if (isProblem(result)) throw new Error(`The review was refused: ${result.problem}.`);
	return result.id;
}
