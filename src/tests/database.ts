import { can } from "@src/auth/permissions";
import { createDatabase } from "@src/db";
import type { Database } from "@src/db";
import { createClient, migrateClient } from "@src/db/client";
import type { Client } from "@src/db/client";
import { users } from "@src/db/schema";

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

export function banAs(db: Database, adminId: number, userId: number) {
	return db.mutations.users.ban(userId, adminId, (actor, target) => can(actor, "user:ban", target));
}
