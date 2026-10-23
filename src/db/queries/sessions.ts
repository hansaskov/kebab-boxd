import { and, count, desc, eq, gt, max, sql } from "drizzle-orm";
import type { Client } from "@src/db/client";
import { encodedPlaceholder } from "@src/db/placeholder";
import * as s from "@src/db/schema";

export const inactivityTimeoutSeconds = 60 * 60 * 24 * 30;

function sessionsActiveSince() {
	return new Date(Date.now() - inactivityTimeoutSeconds * 1000);
}

export function createSessionQueries(client: Client) {
	const withUser = client.query.sessions
		.findFirst({
			with: { user: true },
			where: { id: sql.placeholder("id") },
		})
		.prepare();

	const lastRequestAt = max(s.history.requestedAt);
	const activeByUser = client
		.select({
			id: s.sessions.id,
			createdAt: s.sessions.createdAt,
			lastVerifiedAt: s.sessions.lastVerifiedAt,
			lastRequestAt,
			requestCount: count(s.history.requestedAt),
			signInOrder: sql<number>`row_number() over (order by ${s.sessions.createdAt}, ${s.sessions.id})`,
		})
		.from(s.sessions)
		.leftJoin(s.history, eq(s.history.sessionId, s.sessions.id))
		.where(
			and(
				eq(s.sessions.userId, sql.placeholder("userId")),
				gt(s.sessions.lastVerifiedAt, encodedPlaceholder("activeSince", s.sessions.lastVerifiedAt)),
			),
		)
		.groupBy(s.sessions.id)
		.orderBy(desc(lastRequestAt), desc(s.sessions.createdAt), desc(s.sessions.id))
		.prepare();

	const listActive = (userId: number) => activeByUser.all({ userId, activeSince: sessionsActiveSince() });

	return {
		async findWithUser(id: string) {
			return withUser.execute({ id });
		},

		async listActive(userId: number) {
			return listActive(userId);
		},

		async findActive(sessionId: string, userId: number) {
			return listActive(userId).find((session) => session.id === sessionId);
		},
	};
}
