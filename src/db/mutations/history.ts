import type { Client } from "@src/db/client";
import * as s from "@src/db/schema";
import type { NewHistoryEntry } from "@src/db/schema";

export function createHistoryMutations(client: Client) {
	return {
		async record(entry: Required<NewHistoryEntry>) {
			await client.insert(s.history).values(entry);
		},
	};
}
