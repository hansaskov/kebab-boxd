import { createDatabase } from "@src/db";
import { createClient, migrateClient } from "@src/db/client";
import type { Client } from "@src/db/client";
import { users } from "@src/db/schema";

/**
 * A migrated in-memory database with its own name. Tests set up and inspect rows through `client`
 * and give `db` to the code under test, as the app does.
 */
export function createTestDatabase(name: string) {
	const client = createClient(`file:${name}?mode=memory`);
	migrateClient(client);
	return { client, db: createDatabase(client) };
}

export function insertUser(client: Client, username: string, role: "user" | "admin" = "user") {
	return client
		.insert(users)
		.values({ fullname: `${username} user`, username, email: `${username}@example.com`, role })
		.returning()
		.get();
}
