import type { AstroCookies } from "astro";
import { generateSecureRandomString, hashSecret } from "@src/auth/hash";
import { inactivityTimeoutSeconds } from "@src/privacy/retention";
import type { Database } from "@src/db";
import type { RemoteDatabase } from "@src/db/remote";

// A session is a row in the database and a cookie in the browser that holds its token, `<id>.<secret>`. Only a
// hash of the secret is stored, so a copy of the database signs no one in. A session lasts while its browser comes
// back within the inactivity timeout.
//
// Signing out, a ban and a deleted account only delete rows. The next request finds no session for the cookie and
// removes it, so nothing else has to know about the cookie.

export const sessionCookieName = "__Host-session";

function setCookie(cookies: AstroCookies, value: string, expires: Date) {
	cookies.set(sessionCookieName, value, { httpOnly: true, path: "/", secure: true, sameSite: "lax", expires });
}

// A new session: the row to store, without its user, and the token for the cookie.
export function newSession() {
	const id = generateSecureRandomString();
	const secret = generateSecureRandomString();
	return { row: { id, secretHash: hashSecret(secret) }, token: `${id}.${secret}` };
}

// Creates a session for the user and returns its token. The id is for the tests, which look at the row.
export async function createSession(db: Database, userId: number): Promise<{ id: string; token: string }> {
	const { row, token } = newSession();
	await db.sessions.create({ ...row, userId, lastVerifiedAt: new Date() });
	return { id: row.id, token };
}

// The session of the token with its user, or null when the token is not one, the session has timed out or its user
// is banned. Keeps the session alive.
export async function findSession(db: Database, token: string) {
	return db.sessions.open(token, { takeActionOutcome: false });
}

// Signs the user in on this browser, with the token of a session the database has stored.
export function startSession(cookies: AstroCookies, token: string) {
	setCookie(cookies, token, new Date(Date.now() + inactivityTimeoutSeconds * 1000));
}

// The session of this browser, or null. Moves the end of the cookie along with the session, and removes a cookie
// that has no session. A page takes the outcome of the form sent before it, so that it shows only once.
export async function readSession(cookies: AstroCookies, db: RemoteDatabase, { takeActionOutcome }: { takeActionOutcome: boolean }) {
	const token = cookies.get(sessionCookieName)?.value;
	if (!token) return null;

	const session = await db.load(db.sessions.open(token, { takeActionOutcome }));
	if (session) setCookie(cookies, token, new Date(session.lastVerifiedAt.getTime() + inactivityTimeoutSeconds * 1000));
	else setCookie(cookies, "", new Date(0));
	return session;
}

export type SessionWithUser = Awaited<ReturnType<typeof readSession>>;
