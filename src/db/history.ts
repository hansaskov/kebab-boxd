import type { Client } from "@src/db/client";
import { cursorList } from "@src/db/pagination";
import * as s from "@src/db/schema";
import type { NewHistoryEntry } from "@src/db/schema";
import type { PageRequest } from "@src/pagination";

// Several requests of a device can arrive in the same millisecond, so the id orders those.
const pages = cursorList("history", ["requestedAt", "id"], "desc");

// The pages each signed-in device opened.
export function createHistory(client: Client) {
	return {
		async record(entry: Required<Omit<NewHistoryEntry, "id">>) {
			await client.insert(s.history).values(entry);
		},

		async listBySession(sessionId: string, page: PageRequest) {
			return pages(page, (seek) =>
				client.query.history.findMany({
					columns: { id: true, requestedAt: true, method: true, path: true, action: true, status: true, prefetched: true },
					...seek({ sessionId }),
				}),
			);
		},
	};
}
