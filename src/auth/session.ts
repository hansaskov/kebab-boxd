import { and, count, desc, eq, gt, lt, max, or, sql } from "drizzle-orm";
import { alias } from "drizzle-orm/sqlite-core";
import { s } from "@src/db";
import type { DB } from "@src/db";
import { constantTimeEqual, generateSecureRandomString, hashSecret } from "@src/auth/hash";
import type { AstroCookies } from "astro";

const inactivityTimeoutSeconds = 60 * 60 * 24 * 30; // 30 days
const activityCheckIntervalSeconds = 60 * 60 * 24; // 24 hours

// The __Host- prefix makes browsers reject the cookie unless it is Secure, has
// Path=/ and no Domain, so a subdomain or a plain HTTP page cannot plant it.
export const sessionCookieName = "__Host-session";

export async function getSessionAndUserFromCookie(cookies: AstroCookies, db: DB) {
	const token = cookies.get(sessionCookieName)?.value ?? null;

	if (!token) return null;

	const session = await validateSessionToken(token, db);

	if (session !== null) {
		setSessionTokenCookie(cookies, token, session.lastVerifiedAt);
		return session;
	} else {
		deleteSessionTokenCookie(cookies);
		return null;
	}
}

export async function validateSessionToken(token: string, db: DB) {
	const now = new Date();

	const tokenParts = token.split(".");
	if (tokenParts.length !== 2) {
		return null;
	}
	const [sessionId, sessionSecret] = tokenParts;
	if (!sessionId || !sessionSecret) {
		return null;
	}

	const session = await getSession(sessionId, db);
	if (!session) {
		return null;
	}

	const tokenSecretHash = hashSecret(sessionSecret);
	const validSecret = constantTimeEqual(tokenSecretHash, session.secretHash);
	if (!validSecret) {
		return null;
	}

	if (now.getTime() - session.lastVerifiedAt.getTime() >= activityCheckIntervalSeconds * 1000) {
		session.lastVerifiedAt = now;
		await db.update(s.sessions).set({ lastVerifiedAt: now }).where(eq(s.sessions.id, sessionId));
	}

	return session;
}

export async function createSession(userId: number, db: DB): Promise<SessionWithToken> {
	const now = new Date();

	const id = generateSecureRandomString();
	const secret = generateSecureRandomString();
	const secretHash = hashSecret(secret);

	const token = `${id}.${secret}`;

	const session: SessionWithToken = {
		id,
		userId,
		secretHash,
		lastVerifiedAt: now,
		token,
	};

	await db.insert(s.sessions).values(session);

	return session;
}

export async function getSession(sessionId: string, db: DB) {
	const now = new Date();

	const session = await db.query.sessions.findFirst({
		with: { user: true },
		where: { id: sessionId },
	});

	if (!session) {
		return null;
	}

	if (now.getTime() - session.lastVerifiedAt.getTime() >= inactivityTimeoutSeconds * 1000) {
		await db.delete(s.sessions).where(eq(s.sessions.id, sessionId));
		return null;
	}

	return session;
}

export async function deleteSession(sessionId: string, db: DB): Promise<void> {
	await db.delete(s.sessions).where(eq(s.sessions.id, sessionId));
}

export async function deleteUserSessions(userId: number, db: DB): Promise<void> {
	await db.delete(s.sessions).where(eq(s.sessions.userId, userId));
}

/**
 * Lists the sessions of a user that have not timed out, most recently used first. Sessions used at
 * the same time are listed newest sign-in first; the id settles sign-ins in the same second.
 * `signInOrder` numbers the sessions in the order they signed in, starting at 1.
 */
export async function listActiveUserSessions(userId: number, db: DB) {
	const cutoff = new Date(Date.now() - inactivityTimeoutSeconds * 1000);
	const lastRequestAt = max(s.history.requestedAt);

	return db
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
		.where(and(eq(s.sessions.userId, userId), gt(s.sessions.lastVerifiedAt, cutoff)))
		.groupBy(s.sessions.id)
		.orderBy(desc(lastRequestAt), desc(s.sessions.createdAt), desc(s.sessions.id));
}

export const sessionHistoryPageSizes = [10, 25, 50, 100] as const;
export const sessionHistoryPageSize = 25;

/**
 * Where a page of session history starts. `before` gives the requests older than that time,
 * `after` the requests newer than it. Neither gives the newest requests.
 */
export type SessionHistoryCursor = { before: Date } | { after: Date } | Record<string, never>;

/**
 * Returns one active session of the user with this username, with its request totals and one page
 * of its requests, newest first. Returns undefined if the user has no such session.
 *
 * The page is found from the time of a request (keyset pagination), so requests recorded while the
 * user reads the history do not move the pages. `newer` and `older` are the cursors for the pages
 * on either side, or null if there are no requests on that side.
 *
 * Everything comes from one database query.
 */
export async function getActiveUserSessionHistory(
	sessionId: string,
	username: string,
	db: DB,
	cursor: SessionHistoryCursor = {},
	limit = sessionHistoryPageSize,
) {
	const cutoff = new Date(Date.now() - inactivityTimeoutSeconds * 1000);
	const earlier = alias(s.sessions, "earlier_sessions");
	const after = "after" in cursor ? cursor.after : undefined;
	const before = "before" in cursor ? cursor.before : undefined;

	const session = await db.query.sessions.findFirst({
		columns: { id: true, createdAt: true },
		where: { id: sessionId, lastVerifiedAt: { gt: cutoff }, user: { username } },
		extras: {
			requestCount: (t) => db.$count(s.history, eq(s.history.sessionId, t.id)),
			firstRequestAt: (t) =>
				sql<Date | null>`(select min(${s.history.requestedAt}) from ${s.history} where ${s.history.sessionId} = ${t.id})`.mapWith(
					s.history.requestedAt,
				),
			lastRequestAt: (t) =>
				sql<Date | null>`(select max(${s.history.requestedAt}) from ${s.history} where ${s.history.sessionId} = ${t.id})`.mapWith(
					s.history.requestedAt,
				),
			// The active sessions of the same user that signed in first, as in `listActiveUserSessions`.
			signInOrder: (t) =>
				sql<number>`(${db
					.select({ count: count() })
					.from(earlier)
					.where(
						and(
							eq(earlier.userId, t.userId),
							gt(earlier.lastVerifiedAt, cutoff),
							or(lt(earlier.createdAt, t.createdAt), and(eq(earlier.createdAt, t.createdAt), lt(earlier.id, t.id))),
						),
					)}) + 1`.mapWith(Number),
		},
		with: {
			user: { columns: { username: true, fullname: true } },
			history: {
				columns: { requestedAt: true, method: true, path: true, action: true, status: true },
				where: after ? { requestedAt: { gt: after } } : before ? { requestedAt: { lt: before } } : undefined,
				// Newer pages are read from the oldest request up, then turned around.
				orderBy: { requestedAt: after ? "asc" : "desc" },
				limit,
			},
		},
	});

	if (!session) return undefined;

	const { history, ...rest } = session;
	const entries = after ? history.toReversed() : history;
	const newest = entries.at(0)?.requestedAt;
	const oldest = entries.at(-1)?.requestedAt;

	return {
		...rest,
		entries,
		newer: newest && session.lastRequestAt && newest < session.lastRequestAt ? newest : null,
		older: oldest && session.firstRequestAt && oldest > session.firstRequestAt ? oldest : null,
	};
}

export function setSessionTokenCookie(
	cookies: AstroCookies,
	token: string,
	lastVerifiedAt: Date,
): void {
	cookies.set(sessionCookieName, token, {
		httpOnly: true,
		path: "/",
		secure: true,
		sameSite: "lax",
		expires: new Date(lastVerifiedAt.getTime() + inactivityTimeoutSeconds * 1000),
	});
}

export function deleteSessionTokenCookie(cookies: AstroCookies): void {
	cookies.set(sessionCookieName, "", {
		httpOnly: true,
		path: "/",
		secure: true,
		sameSite: "lax",
		maxAge: 0,
	});
}

interface SessionWithToken extends Session {
	token: string;
}

export type Session = typeof s.sessions.$inferInsert;
export type SessionWithUser = Awaited<ReturnType<typeof getSessionAndUserFromCookie>>
