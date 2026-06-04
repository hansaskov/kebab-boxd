import { eq } from "drizzle-orm";
import { db } from "../db";
import * as s from "../db/schema";
import { constantTimeEqual, generateSecureRandomString, hashSecret } from "./hash";
import type { APIContext } from "astro";

const inactivityTimeoutSeconds = 60 * 60 * 24 * 30; // 30 days
const activityCheckIntervalSeconds = 60 * 60 * 24; // 24 hours

export async function createSession(userId: number): Promise<SessionWithToken> {
  const now = new Date();

  const id = generateSecureRandomString();
  const secret = generateSecureRandomString();
  const secretHash = await hashSecret(secret);

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

export async function getSession(sessionId: string) {
  const now = new Date();

  const session = await db.query.sessions.findFirst({
    with: { user: true },
    where: { id: sessionId },
  });

  if (!session) {
    return null;
  }

  // Inactivity timeout
  if (now.getTime() - session.lastVerifiedAt.getTime() >= inactivityTimeoutSeconds * 1000) {
    await db.delete(s.sessions).where(eq(s.sessions.id, sessionId));
    return null;
  }

  return session;
}

export async function validateSessionToken(token: string) {
  const now = new Date();

  const tokenParts = token.split(".");
  if (tokenParts.length !== 2) {
    return null;
  }
  const sessionId = tokenParts[0];
  const sessionSecret = tokenParts[1];

  const session = await getSession(sessionId);
  if (!session) {
    return null;
  }

  const tokenSecretHash = await hashSecret(sessionSecret);
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

export async function deleteSession(sessionId: string): Promise<void> {
  await db.delete(s.sessions).where(eq(s.sessions.id, sessionId));
}

export function setSessionTokenCookie(
  context: APIContext,
  token: string,
  lastVerifiedAt: Date,
): void {
  context.cookies.set("session", token, {
    httpOnly: true,
    path: "/",
    secure: import.meta.env.PROD,
    sameSite: "lax",
    expires: new Date(lastVerifiedAt.getTime() + inactivityTimeoutSeconds * 1000),
  });
}

export function deleteSessionTokenCookie(context: APIContext): void {
  context.cookies.set("session", "", {
    httpOnly: true,
    path: "/",
    secure: import.meta.env.PROD,
    sameSite: "lax",
    maxAge: 0,
  });
}

interface SessionWithToken extends Session {
  token: string;
}

export type Session = typeof s.sessions.$inferInsert;
