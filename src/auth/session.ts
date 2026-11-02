import type { AstroCookies } from "astro";
import { constantTimeEqual, generateSecureRandomString, hashSecret } from "@src/auth/hash";
import { inactivityTimeoutSeconds } from "@src/data/retention-periods";
import type { Database } from "@src/db";

// A session is a row in the database and a cookie in the browser that holds its token, `<id>.<secret>`. Only a
// hash of the secret is stored, so a copy of the database signs no one in. A session lasts while its browser comes
// back within the inactivity timeout.
//
// Signing out, a ban and a deleted account only delete rows. The next request finds no session for the cookie and
// removes it, so nothing else has to know about the cookie.

export const sessionCookieName = "__Host-session";

// Saving the time of every request would cost a write on every page, so the time is saved at most once a day.
const verifyIntervalMs = 24 * 60 * 60 * 1000;

function setCookie(cookies: AstroCookies, value: string, expires: Date) {
	cookies.set(sessionCookieName, value, { httpOnly: true, path: "/", secure: true, sameSite: "lax", expires });
}

// Creates a session for the user and returns its token. The id is for the tests, which look at the row.
export async function createSession(db: Database, userId: number): Promise<{ id: string; token: string }> {
	const id = generateSecureRandomString();
	const secret = generateSecureRandomString();
	await db.sessions.create({ id, userId, secretHash: hashSecret(secret), lastVerifiedAt: new Date() });
	return { id, token: `${id}.${secret}` };
}

// The session of the token with its user, or null when the token is not one, the session has timed out or its user
// is banned. Keeps the session alive.
export async function findSession(db: Database, token: string) {
	const [id, secret, ...rest] = token.split(".");
	if (!id || !secret || rest.length > 0) return null;

	const session = await db.sessions.findActiveWithUser(id);
	if (!session || !constantTimeEqual(hashSecret(secret), session.secretHash)) return null;

	const now = new Date();
	if (now.getTime() - session.lastVerifiedAt.getTime() >= verifyIntervalMs) {
		session.lastVerifiedAt = now;
		await db.sessions.setLastVerifiedAt(id, now);
	}
	return session;
}

// Signs the user in on this browser.
export async function startSession(cookies: AstroCookies, db: Database, userId: number) {
	const { token } = await createSession(db, userId);
	setCookie(cookies, token, new Date(Date.now() + inactivityTimeoutSeconds * 1000));
}

// The session of this browser, or null. Moves the end of the cookie along with the session, and removes a cookie
// that has no session.
export async function readSession(cookies: AstroCookies, db: Database) {
	const token = cookies.get(sessionCookieName)?.value;
	if (!token) return null;

	const session = await findSession(db, token);
	if (session) setCookie(cookies, token, new Date(session.lastVerifiedAt.getTime() + inactivityTimeoutSeconds * 1000));
	else setCookie(cookies, "", new Date(0));
	return session;
}

export type SessionWithUser = Awaited<ReturnType<typeof readSession>>;
