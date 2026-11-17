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

// Saving the time of every request would cost a write on every page, so the time is saved at most once a day.
const verifyIntervalMs = 24 * 60 * 60 * 1000;

// The id and the secret of a session token, `<id>.<secret>`, or undefined when the text is no token.
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
		// The session of the token with its user, for one request, or null when the token is not one, the session has
		// timed out or its user is banned. Keeps the session alive. A page takes the outcome of the form the user sent
		// before it, which only that page shows. One call does it all, since every request of a User waits for it.
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
								// Every page shows the count, so it comes with the session instead of costing a call of its own.
								extras: { unreadNotificationCount: (user) => tx.$count(s.notifications, isUnreadOf(user.id)) },
							},
						},
						where: { id: parsed.id, lastVerifiedAt: { gt: activeSince() }, user: { bannedAt: { isNull: true } } },
					})
					.sync();
				// Only a hash of the secret is stored, and it never leaves the database.
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

		// The devices the User named `username` is signed in on, the last used first, for a viewer who manages them.
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

		// Keeps the outcome of a form for the page after it, which takes it when it opens the session.
		async setActionData(id: string, actionData: ActionOutcome) {
			await client.update(s.sessions).set({ actionData }).where(eq(s.sessions.id, id));
		},

		async delete(id: string) {
			await client.delete(s.sessions).where(eq(s.sessions.id, id));
		},
	};
}
