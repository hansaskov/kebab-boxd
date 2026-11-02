import { and, eq, exists, isNull, max, or, sql, type SQLWrapper } from "drizzle-orm";
import { inactivityTimeoutSeconds } from "@src/data/retention-periods";
import type { Client } from "@src/db/client";
import * as s from "@src/db/schema";

// A notification is hidden while the user who caused it is banned.
function isUnreadOf(client: Client, recipientId: SQLWrapper) {
	const n = s.notifications;
	const actorIsUnbanned = exists(
		client
			.select({ row: sql`1` })
			.from(s.users)
			.where(and(eq(s.users.id, n.actorId), isNull(s.users.bannedAt))),
	);
	return and(eq(n.recipientId, recipientId), isNull(n.readAt), or(isNull(n.actorId), actorIsUnbanned));
}

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
				with: {
					user: {
						with: { profilePicture: { columns: { url: true } } },
						// Every page shows the count, so it comes with the session instead of costing a query of its own.
						// "Mark all as read" marks up to the newest, so it marks the notifications the count told of.
						extras: {
							unreadNotificationCount: (user) => client.$count(s.notifications, isUnreadOf(client, user.id)),
							newestUnreadNotificationId: (user) =>
								sql<number | null>`(${client.select({ id: max(s.notifications.id) }).from(s.notifications).where(isUnreadOf(client, user.id))})`,
						},
					},
				},
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
