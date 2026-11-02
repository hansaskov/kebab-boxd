import type { Database } from "@src/db";
import type { NewSession } from "@src/db/schema";
import { inactivityTimeoutSeconds } from "@src/data/retention-periods";
import { constantTimeEqual, generateSecureRandomString, hashSecret } from "@src/auth/hash";
import type { AstroCookies } from "astro";

const activityCheckIntervalSeconds = 60 * 60 * 24;

export const sessionCookieName = "__Host-session";

export async function getSessionAndUserFromCookie(cookies: AstroCookies, db: Database) {
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

export async function validateSessionToken(token: string, db: Database) {
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
		await db.sessions.setLastVerifiedAt(sessionId, now);
	}

	return session;
}

export async function createSession(userId: number, db: Database): Promise<SessionWithToken> {
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

	await db.sessions.create(session);

	return session;
}

export async function getSession(sessionId: string, db: Database) {
	const now = new Date();

	const session = await db.sessions.findWithUser(sessionId);

	if (!session) {
		return null;
	}

	if (session.user.bannedAt || now.getTime() - session.lastVerifiedAt.getTime() >= inactivityTimeoutSeconds * 1000) {
		await db.sessions.delete(sessionId);
		return null;
	}

	return session;
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

interface SessionWithToken extends Pick<NewSession, "id" | "userId" | "secretHash" | "lastVerifiedAt"> {
	token: string;
}

export type SessionWithUser = Awaited<ReturnType<typeof getSessionAndUserFromCookie>>
