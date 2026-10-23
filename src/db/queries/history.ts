import { and, eq, sql } from "drizzle-orm";
import type { Client } from "@src/db/client";
import { cursorList } from "@src/db/pagination";
import * as s from "@src/db/schema";
import type { PageRequest } from "@src/pagination";

export function createHistoryQueries(client: Client) {
	const bySession = cursorList(s.history, ["requestedAt"], "desc", (seek) =>
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
			.orderBy(...seek.orderBy)
			.limit(seek.limit)
			.prepare(),
	);

	return {
		async listBySession(sessionId: string, page: PageRequest) {
			return bySession(page, { sessionId });
		},
	};
}
