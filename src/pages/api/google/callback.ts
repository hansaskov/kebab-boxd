// pages/login/google/callback.ts
import { createSession, setSessionTokenCookie } from "@src/auth/session";
import { google, decodeIdToken } from "@src/auth/oauth";
import type { GoogleTokenResponse } from "@src/auth/oauth";
import { z } from "astro/zod";
import { eq } from "drizzle-orm";

import type { APIContext } from "astro";
import { s } from "@src/db/index";

export const GoogleClaimsSchema = z.object({
	sub: z.string().min(1),
	name: z.string().min(1),
	picture: z.url(),
	email: z.email(),
	email_verified: z.boolean(),
});

export async function GET(context: APIContext): Promise<Response> {
	const storedState = context.cookies.get("google_oauth_state")?.value ?? null;
	const codeVerifier = context.cookies.get("google_code_verifier")?.value ?? null;
	const code = context.url.searchParams.get("code");
	const state = context.url.searchParams.get("state");

	if (storedState === null || codeVerifier === null || code === null || state === null) {
		return new Response("Please restart the process.", {
			status: 400,
		});
	}
	if (storedState !== state) {
		return new Response("Please restart the process.", {
			status: 400,
		});
	}

	let tokens: GoogleTokenResponse;
	try {
		tokens = await google.validateAuthorizationCode(code, codeVerifier);
		context.cookies.delete("google_oauth_state", { path: "/" });
		context.cookies.delete("google_code_verifier", { path: "/" });
	} catch (e) {
		return new Response("Please restart the process.", {
			status: 400,
		});
	}

	let claims: z.infer<typeof GoogleClaimsSchema>;
	try {
		const raw = decodeIdToken(tokens.id_token);
		claims = GoogleClaimsSchema.parse(raw);
	} catch (e) {
		if (e instanceof z.ZodError) {
			return new Response(e.message, {
				status: 400,
			});
		}
		return new Response("Failed to parse claim", {
			status: 400,
		});
	}

	const googleId = claims.sub;
	const fullname = claims.name;
	const firstName = fullname.trim().split(/\s+/).at(0);
	if (!firstName) {
		return new Response("Invalid name claim.", {
			status: 400,
		});
	}
	const email = claims.email;

	const db = context.locals.db;

	const existingUser = await db.query.users.findFirst({ where: { googleId: googleId } });

	if (existingUser) {
		const session = await createSession(existingUser.id, db);
		setSessionTokenCookie(context.cookies, session.token, session.lastVerifiedAt);
		return context.redirect("/");
	}

	const user = db.transaction((tx) => {
		const inserted = tx
			.insert(s.users)
			.values({
				googleId: googleId,
				fullname: fullname,
				username: googleId,
				email: email,
			})
			.returning()
			.get();

		if (!inserted) {
			tx.rollback();
			return null;
		}

		const actualUsername = `${firstName}#${inserted.id}`;
		tx.update(s.users).set({ username: actualUsername }).where(eq(s.users.id, inserted.id)).run();

		return { ...inserted, username: actualUsername };
	});

	if (!user) {
		return new Response("Database issue when inserting new", {
			status: 500,
		});
	}

	const session = await createSession(user.id, db);
	setSessionTokenCookie(context.cookies, session.token, session.lastVerifiedAt);
	return context.redirect("/");
}
