import type { AstroCookies } from "astro";
import { generateSecureRandomString, hashSecret } from "@src/auth/hash";
import { inactivityTimeoutSeconds } from "@src/privacy/retention";
import type { Database } from "@src/db";
import type { SessionWithUser } from "@src/auth/sessions.db";

export const sessionCookieName = "__Host-session";

function setCookie(cookies: AstroCookies, value: string, expires: Date) {
	cookies.set(sessionCookieName, value, { httpOnly: true, path: "/", secure: true, sameSite: "lax", expires });
}

export function newSession() {
	const id = generateSecureRandomString();
	const secret = generateSecureRandomString();
	return { row: { id, secretHash: hashSecret(secret) }, token: `${id}.${secret}` };
}

export async function createSession(db: Database, userId: number): Promise<{ id: string; token: string }> {
	const { row, token } = newSession();
	await db.sessions.create({ ...row, userId, lastVerifiedAt: new Date() });
	return { id: row.id, token };
}

export async function findSession(db: Database, token: string) {
	return db.sessions.open(token, { takeActionOutcome: false });
}

export function startSession(cookies: AstroCookies, token: string) {
	setCookie(cookies, token, new Date(Date.now() + inactivityTimeoutSeconds * 1000));
}

export function sessionTokenOf(cookies: AstroCookies) {
	return cookies.get(sessionCookieName)?.value;
}

export function keepSessionCookie(cookies: AstroCookies, token: string, session: SessionWithUser | null) {
	if (session) setCookie(cookies, token, new Date(session.lastVerifiedAt.getTime() + inactivityTimeoutSeconds * 1000));
	else setCookie(cookies, "", new Date(0));
}
