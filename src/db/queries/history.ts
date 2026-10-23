import type { Client } from "@src/db/client";
import { cursorList } from "@src/db/pagination";
import * as s from "@src/db/schema";
import type { PageRequest } from "@src/pagination";

// Several requests of a device can arrive in the same millisecond, so the id orders those.
const pages = cursorList(s.history, ["requestedAt", "id"], "desc");

export function createHistoryQueries(client: Client) {
	return {
		async listBySession(sessionId: string, page: PageRequest) {
			return pages(page, (seek) =>
				client.query.history.findMany({
					columns: { id: true, requestedAt: true, method: true, path: true, action: true, status: true, prefetched: true },
					where: { AND: [{ sessionId }, seek.where] },
					orderBy: seek.orderBy,
					limit: seek.limit,
				}),
			);
		},
	};
}
