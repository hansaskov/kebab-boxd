import type { Client } from "@src/db/client";
import { cursorList } from "@src/db/pagination";
import * as s from "@src/db/schema";
import type { PageRequest } from "@src/pagination";

const pages = cursorList(s.history, ["requestedAt"], "desc");

export function createHistoryQueries(client: Client) {
	return {
		async listBySession(sessionId: string, page: PageRequest) {
			return pages(page, (seek) =>
				client.query.history.findMany({
					columns: { requestedAt: true, method: true, path: true, action: true, status: true, prefetched: true },
					where: { AND: [{ sessionId }, seek.where] },
					orderBy: seek.orderBy,
					limit: seek.limit,
				}),
			);
		},
	};
}
