import { sql } from "drizzle-orm";
import type { Client } from "@src/db/client";
import * as s from "@src/db/schema";
import type { NewHistoryEntry } from "@src/db/schema";

export function createHistoryMutations(client: Client) {
	const insert = client
		.insert(s.history)
		.values({
			sessionId: sql.placeholder("sessionId"),
			requestedAt: sql.placeholder("requestedAt"),
			method: sql.placeholder("method"),
			route: sql.placeholder("route"),
			path: sql.placeholder("path"),
			action: sql.placeholder("action"),
			status: sql.placeholder("status"),
		})
		.prepare();

	return {
		async record(entry: Required<NewHistoryEntry>) {
			insert.run(entry);
		},
	};
}
