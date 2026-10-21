import { sql } from "drizzle-orm";
import type { Client } from "@src/db/client";

export function createUserQueries(client: Client) {
	const byUsername = client.query.users
		.findFirst({ where: { username: sql.placeholder("username") } })
		.prepare();

	return {
		/** Finds the user with exactly this username. Usernames are stored in lowercase. */
		async findByUsername(username: string) {
			return byUsername.execute({ username });
		},
	};
}
