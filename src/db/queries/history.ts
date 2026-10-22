import { and, eq, sql } from "drizzle-orm";
import type { Client } from "@src/db/client";
import { cursorList } from "@src/db/pagination";
import * as s from "@src/db/schema";
import type { PageRequest } from "@src/pagination";

export function createHistoryQueries(client: Client) {
	// Newest first. The time is unique within a session, as it is part of the primary key.
	const bySession = cursorList(s.history, "requestedAt", "desc", (seek) =>
		client
			.select({
				requestedAt: s.history.requestedAt,
				method: s.history.method,
				path: s.history.path,
				action: s.history.action,
				status: s.history.status,
				prefetched: s.history.prefetched,
			})
			.from(s.history)
			.where(and(eq(s.history.sessionId, sql.placeholder("sessionId")), seek.where))
			.orderBy(seek.orderBy)
			.limit(seek.limit)
			.prepare(),
	);

	return {
		/** One page of the requests a session made, newest first. Check that the session may be seen first. */
		async listBySession(sessionId: string, page: PageRequest) {
			return bySession(page, { sessionId });
		},
	};
}
