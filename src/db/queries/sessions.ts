import { eq, sql } from "drizzle-orm";
import { inactivityTimeoutSeconds } from "@src/data/retention-periods";
import type { Client } from "@src/db/client";
import * as s from "@src/db/schema";

function activeSince() {
	return new Date(Date.now() - inactivityTimeoutSeconds * 1000);
}

export function createSessionQueries(client: Client) {
	const listActive = (userId: number) =>
		client.query.sessions.findMany({
			columns: { id: true, createdAt: true, lastVerifiedAt: true },
			with: {
				history: { columns: { requestedAt: true }, orderBy: { requestedAt: "desc" }, limit: 1 },
			},
			extras: {
				requestCount: (session) => client.$count(s.history, eq(s.history.sessionId, session.id)),
				signInOrder: (session) => sql<number>`row_number() over (order by ${session.createdAt}, ${session.id})`,
			},
			where: { userId, lastVerifiedAt: { gt: activeSince() } },
			orderBy: { history: { requestedAt: "desc(max)" }, createdAt: "desc", id: "desc" },
		});

	return {
		async findWithUser(id: string) {
			return client.query.sessions.findFirst({
				with: { user: { with: { profilePicture: { columns: { url: true } } } } },
				where: { id },
			});
		},

		async listActive(userId: number) {
			return listActive(userId);
		},

		async findActive(sessionId: string, userId: number) {
			return (await listActive(userId)).find((session) => session.id === sessionId);
		},
	};
}
