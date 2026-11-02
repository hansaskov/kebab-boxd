import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { onTestFinished } from "vitest";
import { createSession, getSession } from "@src/auth/session";
import { createDatabase } from "@src/db";
import type { Database } from "@src/db";
import { createClient, migrateClient } from "@src/db/client";
import type { Client } from "@src/db/client";
import { isProblem } from "@src/db/problem";
import * as s from "@src/db/schema";
import type { PageRequest } from "@src/pagination";
import { createPictureStore } from "@src/pictures/store";

export const firstPage: PageRequest = { limit: 10, cursor: undefined };

// A new, empty database for one test. Its picture folder is removed when the test ends.
export function createTestDatabase() {
	const client = createClient(":memory:");
	migrateClient(client);
	const picturesDirectory = mkdtempSync(join(tmpdir(), "kebab-boxd-pictures-"));
	onTestFinished(() => rmSync(picturesDirectory, { recursive: true, force: true }));
	return { client, db: createDatabase(client, createPictureStore(picturesDirectory)), picturesDirectory };
}

export function insertUser(client: Client, username: string, role: "user" | "admin" = "user") {
	return client
		.insert(s.users)
		.values({ fullname: `${username} user`, username, email: `${username}@example.com`, role })
		.returning()
		.get();
}

export async function signIn(db: Database, userId: number) {
	const session = await getSession((await createSession(userId, db)).id, db);
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

// Writes the row directly, so the test can choose when it was written. Leaves the cached rating alone.
export function insertReview(client: Client, authorId: number, restaurantId: number, rating: number, createdAt = new Date()) {
	return client.insert(s.reviews).values({ authorId, restaurantId, rating, createdAt }).returning().get();
}

// Publishes a review the way a user does, so the cached rating of the restaurant follows.
export async function writeReview(db: Database, authorId: number, restaurantId: number, rating: number, files: File[] = []) {
	const result = await db.reviews.create(authorId, restaurantId, { rating, description: null }, files);
	if (isProblem(result)) throw new Error(`The review was refused: ${result.problem}.`);
	return result.id;
}

// The newest notification the user has not read, as every page of theirs gets it with the session.
export async function newestUnreadId(db: Database, userId: number) {
	return (await signIn(db, userId)).user.newestUnreadNotificationId;
}
