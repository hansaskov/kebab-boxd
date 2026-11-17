import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-sqlite";
import { migrate } from "drizzle-orm/node-sqlite/migrator";
import { onTestFinished } from "vitest";
import { createSession, findSession } from "@src/auth/session";
import { createDatabase } from "@src/db";
import type { Database } from "@src/db";
import type { Client } from "@src/db/client";
import { relations } from "@src/db/relations";
import { durableSqliteLimits } from "@src/db/limits";
import { isProblem, type Problem } from "@src/db/problem";
import * as s from "@src/db/schema";
import type { PageRequest } from "@src/pagination";
import { createPictureStore } from "@src/pictures/store";
import { images, picturesBucket, removeAllPictures } from "@src/tests/cloudflare";

export const firstPage: PageRequest = { limit: 10, cursor: undefined };

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

export function setLastVerifiedAt(client: Client, sessionId: string, lastVerifiedAt: Date) {
	client.update(s.sessions).set({ lastVerifiedAt }).where(eq(s.sessions.id, sessionId)).run();
}

export const restaurantPlace = { latitude: 55.4, longitude: 10.39 };

export function insertRestaurant(
	client: Client,
	name: string,
	{
		suggestedBy = null,
		status = "pending",
		city = "Odense",
		latitude = restaurantPlace.latitude,
		longitude = restaurantPlace.longitude,
	}: Partial<Pick<s.NewRestaurant, "suggestedBy" | "status"> & Pick<s.NewLocation, "city" | "latitude" | "longitude">> = {},
) {
	const location = client.insert(s.locations).values({ city, latitude, longitude }).returning().get();
	return client.insert(s.restaurants).values({ name, locationId: location.id, suggestedBy, status }).returning().get();
}

export function restaurantRow(client: Client, id: number) {
	return client.query.restaurants.findFirst({ where: { id } }).sync();
}

export function insertReview(client: Client, authorId: number, restaurantId: number, rating: number, createdAt = new Date()) {
	return client.insert(s.reviews).values({ authorId, restaurantId, rating, createdAt }).returning().get();
}

export function allowed<T>(result: T | Problem): T {
	if (isProblem(result)) throw new Error(`The read was refused: ${result.problem}.`);
	return result;
}

export async function writeReview(db: Database, authorId: number, restaurantId: number, rating: number, files: File[] = []) {
	const result = await db.reviews.create(authorId, restaurantId, { rating, description: null }, files);
	if (isProblem(result)) throw new Error(`The review was refused: ${result.problem}.`);
	return result.id;
}
