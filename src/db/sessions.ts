import { eq, sql } from "drizzle-orm";
import type { ActionOutcome } from "@src/actions/outcome";
import { inactivityTimeoutSeconds } from "@src/data/retention-periods";
import type { Client, Transaction } from "@src/db/client";
import { isUnreadOf } from "@src/db/notifications";
import * as s from "@src/db/schema";
import type { NewSession, Session } from "@src/db/schema";

export function deleteAllSessionsOf(tx: Transaction, userId: number) {
	tx.delete(s.sessions).where(eq(s.sessions.userId, userId)).run();
}

function activeSince() {
	return new Date(Date.now() - inactivityTimeoutSeconds * 1000);
}

export function createSessions(client: Client) {
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
		// Leaves out a session that has timed out, or whose user is banned.
		async findActiveWithUser(id: string) {
			return client.query.sessions.findFirst({
				with: {
					user: {
						with: { profilePicture: { columns: { url: true } } },
						// Every page shows the count, so it comes with the session instead of costing a query of its own.
						extras: {
							unreadNotificationCount: (user) => client.$count(s.notifications, isUnreadOf(user.id)),
						},
					},
				},
				where: { id, lastVerifiedAt: { gt: activeSince() }, user: { bannedAt: { isNull: true } } },
			});
		},

		listActive,

		async findActive(sessionId: string, userId: number) {
			return (await listActive(userId)).find((session) => session.id === sessionId);
		},

		async create({ id, userId, secretHash, lastVerifiedAt }: Pick<NewSession, "id" | "userId" | "secretHash" | "lastVerifiedAt">) {
			await client.insert(s.sessions).values({ id, userId, secretHash, lastVerifiedAt });
		},

		async setLastVerifiedAt(id: string, lastVerifiedAt: Date) {
			await client.update(s.sessions).set({ lastVerifiedAt }).where(eq(s.sessions.id, id));
		},

		async setTheme(id: string, theme: Session["theme"]) {
			await client.update(s.sessions).set({ theme }).where(eq(s.sessions.id, id));
		},

		async setActionData(id: string, actionData: ActionOutcome | null) {
			await client.update(s.sessions).set({ actionData }).where(eq(s.sessions.id, id));
		},

		async delete(id: string) {
			await client.delete(s.sessions).where(eq(s.sessions.id, id));
		},
	};
}
