import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createSession, getSession } from "@src/auth/session";
import { createDatabase } from "@src/db";
import type { Database } from "@src/db";
import { createClient, migrateClient } from "@src/db/client";
import type { Client } from "@src/db/client";
import * as s from "@src/db/schema";
import { createPictureStore } from "@src/pictures/store";

export function createTestDatabase(name: string) {
	let recording: string[] | undefined;
	const client = createClient(`file:${name}?mode=memory`, { logQuery: (query) => recording?.push(query) });
	migrateClient(client);
	const picturesDirectory = mkdtempSync(join(tmpdir(), `kebab-boxd-${name}-`));
	const pictures = createPictureStore(picturesDirectory);

	async function recordQueries<T>(work: () => Promise<T>) {
		const queries: string[] = [];
		recording = queries;
		try {
			return { result: await work(), queries };
		} finally {
			recording = undefined;
		}
	}

	return { client, db: createDatabase(client, pictures), picturesDirectory, recordQueries };
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

export function insertReview(client: Client, authorId: number, restaurantId: number, rating: number, createdAt = new Date()) {
	return client.insert(s.reviews).values({ authorId, restaurantId, rating, createdAt }).returning().get();
}

// The newest notification the user has not read, as every page of theirs gets it with the session.
export async function newestUnreadId(db: Database, userId: number) {
	return (await signIn(db, userId)).user.newestUnreadNotificationId;
}
