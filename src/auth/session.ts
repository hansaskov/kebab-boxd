import { and, asc, count, desc, eq, gt, lt, max } from "drizzle-orm";
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
		})
		.from(s.sessions)
		.leftJoin(s.history, eq(s.history.sessionId, s.sessions.id))
		.where(and(eq(s.sessions.userId, userId), gt(s.sessions.lastVerifiedAt, cutoff)))
		.groupBy(s.sessions.id)
		.orderBy(desc(lastRequestAt), desc(s.sessions.createdAt), desc(s.sessions.id));
}

/**
 * Lists the id and sign-in time of each active session of a user, without reading the history.
 * Oldest sign-in first; the id settles sign-ins in the same second, as in `deviceName`.
 */
export async function listActiveUserSessionIds(userId: number, db: DB) {
	const cutoff = new Date(Date.now() - inactivityTimeoutSeconds * 1000);

	return db
		.select({ id: s.sessions.id, createdAt: s.sessions.createdAt })
		.from(s.sessions)
		.where(and(eq(s.sessions.userId, userId), gt(s.sessions.lastVerifiedAt, cutoff)))
		.orderBy(asc(s.sessions.createdAt), asc(s.sessions.id));
}

/** Returns one active session of a user with its request totals, or undefined if the user has no such session. */
export async function getActiveUserSession(sessionId: string, userId: number, db: DB) {
	const cutoff = new Date(Date.now() - inactivityTimeoutSeconds * 1000);

	const [session] = await db
		.select({
			id: s.sessions.id,
			createdAt: s.sessions.createdAt,
			lastVerifiedAt: s.sessions.lastVerifiedAt,
			lastRequestAt: max(s.history.requestedAt),
			requestCount: count(s.history.requestedAt),
		})
		.from(s.sessions)
		.leftJoin(s.history, eq(s.history.sessionId, s.sessions.id))
		.where(
			and(
				eq(s.sessions.id, sessionId),
				eq(s.sessions.userId, userId),
				gt(s.sessions.lastVerifiedAt, cutoff),
			),
		)
		.groupBy(s.sessions.id);

	return session;
}

export const sessionHistoryPageSize = 50;

/**
 * Returns one page of the requests recorded for a session, newest first. Only sessions owned by
 * the user match. Pass `before` (the time of the oldest request already shown) to get the next,
 * older page. `older` is the value to pass as `before` for the page after this one, or null if
 * there are no older requests.
 */
export async function getUserSessionHistory(
	sessionId: string,
	userId: number,
	db: DB,
	{ before, limit = sessionHistoryPageSize }: { before?: Date | undefined; limit?: number } = {},
) {
	// One extra row tells us whether an older page exists.
	const rows = await db
		.select({
			requestedAt: s.history.requestedAt,
			method: s.history.method,
			path: s.history.path,
			action: s.history.action,
			status: s.history.status,
		})
		.from(s.history)
		.innerJoin(s.sessions, eq(s.sessions.id, s.history.sessionId))
		.where(
			and(
				eq(s.history.sessionId, sessionId),
				eq(s.sessions.userId, userId),
				before ? lt(s.history.requestedAt, before) : undefined,
			),
		)
		.orderBy(desc(s.history.requestedAt))
		.limit(limit + 1);

	const entries = rows.slice(0, limit);
	const older = rows.length > limit ? (entries.at(-1)?.requestedAt ?? null) : null;

	return { entries, older };
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
