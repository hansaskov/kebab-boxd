import { createSession, getSession } from "@src/auth/session";
import { createDatabase } from "@src/db";
import type { Database } from "@src/db";
import { createClient, migrateClient } from "@src/db/client";
import type { Client } from "@src/db/client";
import * as s from "@src/db/schema";

export function createTestDatabase(name: string) {
	const client = createClient(`file:${name}?mode=memory`);
	migrateClient(client);
	return { client, db: createDatabase(client) };
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
	{ suggestedBy = null, status = "pending" }: Partial<Pick<s.NewRestaurant, "suggestedBy" | "status">> = {},
) {
	const location = client.insert(s.locations).values({ city: "Odense", latitude: 55.4, longitude: 10.39 }).returning().get();
	return client.insert(s.restaurants).values({ name, locationId: location.id, suggestedBy, status }).returning().get();
}

export function insertReview(client: Client, authorId: number, restaurantId: number, rating: number, createdAt = new Date()) {
	return client.insert(s.reviews).values({ authorId, restaurantId, rating, createdAt }).returning().get();
}
