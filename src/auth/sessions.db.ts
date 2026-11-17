import { eq, sql } from "drizzle-orm";
import type { ActionOutcome } from "@src/actions/outcome";
import { constantTimeEqual, hashSecret } from "@src/auth/hash";
import { inactivityTimeoutSeconds } from "@src/privacy/retention";
import type { Client, Transaction } from "@src/db/client";
import { authorizedRead, findUserSeenBy } from "@src/db/authorize";
import { isUnreadOf } from "@src/notifications/notifications.db";
import * as s from "@src/db/schema";
import type { NewSession, Session } from "@src/db/schema";

export function deleteAllSessionsOf(tx: Transaction, userId: number) {
	tx.delete(s.sessions).where(eq(s.sessions.userId, userId)).run();
}

export function activeSince() {
	return new Date(Date.now() - inactivityTimeoutSeconds * 1000);
}

const verifyIntervalMs = 24 * 60 * 60 * 1000;

function parseToken(token: string) {
	const [id, secret, ...rest] = token.split(".");
	return id && secret && rest.length === 0 ? { id, secret } : undefined;
}

export function createSessions(client: Client) {
	const listActiveOf = (userId: number) =>
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
		async open(token: string, { takeActionOutcome }: { takeActionOutcome: boolean }) {
			const parsed = parseToken(token);
			if (!parsed) return null;

			return client.transaction((tx) => {
				const found = tx.query.sessions
					.findFirst({
						columns: { id: true, secretHash: true, lastVerifiedAt: true, theme: true, actionData: true },
						with: {
							user: {
								with: { profilePicture: { columns: { url: true } } },
								extras: { unreadNotificationCount: (user) => tx.$count(s.notifications, isUnreadOf(user.id)) },
							},
						},
						where: { id: parsed.id, lastVerifiedAt: { gt: activeSince() }, user: { bannedAt: { isNull: true } } },
					})
					.sync();
				if (!found || !constantTimeEqual(hashSecret(parsed.secret), found.secretHash)) return null;

				const { secretHash: _, actionData, ...session } = found;
				const now = new Date();
				const isStale = now.getTime() - session.lastVerifiedAt.getTime() >= verifyIntervalMs;
				const actionOutcome = takeActionOutcome ? actionData : null;
				if (isStale || actionOutcome) {
					tx.update(s.sessions)
						.set({ ...(isStale && { lastVerifiedAt: now }), ...(actionOutcome && { actionData: null }) })
						.where(eq(s.sessions.id, session.id))
						.run();
				}
				return { ...session, lastVerifiedAt: isStale ? now : session.lastVerifiedAt, actionOutcome };
			});
		},

		async listActive(username: string, viewerId: number | null) {
			return authorizedRead(client, viewerId, "user:manage-sessions", findUserSeenBy(client, username, viewerId), async (user) => listActiveOf(user.id));
		},

		async findActive(username: string, sessionId: string, viewerId: number | null) {
			return authorizedRead(client, viewerId, "user:manage-sessions", findUserSeenBy(client, username, viewerId), async (user) =>
				(await listActiveOf(user.id)).find((session) => session.id === sessionId),
			);
		},

		async create({ id, userId, secretHash, lastVerifiedAt }: Pick<NewSession, "id" | "userId" | "secretHash" | "lastVerifiedAt">) {
			await client.insert(s.sessions).values({ id, userId, secretHash, lastVerifiedAt });
		},

		async setTheme(id: string, theme: Session["theme"]) {
			await client.update(s.sessions).set({ theme }).where(eq(s.sessions.id, id));
		},

		async setActionData(id: string, actionData: ActionOutcome) {
			await client.update(s.sessions).set({ actionData }).where(eq(s.sessions.id, id));
		},

		async delete(id: string) {
			await client.delete(s.sessions).where(eq(s.sessions.id, id));
		},
	};
}
