import { google, googleCookieNames, InvalidIdTokenError } from "@src/auth/providers/google";
import { oauthCookieOptions } from "@src/auth/oauth";
import type { ProviderAccount } from "@src/auth/provider-account";
import { createSession, setSessionTokenCookie } from "@src/auth/session";

import type { APIContext } from "astro";

function restart(context: APIContext, reason?: "expired" | "failed" | "banned"): Response {
	return context.redirect(reason ? `/login?error=${reason}` : "/login");
}

export async function GET(context: APIContext): Promise<Response> {
	const storedState = context.cookies.get(googleCookieNames.state)?.value ?? null;
	const codeVerifier = context.cookies.get(googleCookieNames.codeVerifier)?.value ?? null;
	const code = context.url.searchParams.get("code");
	const state = context.url.searchParams.get("state");

	context.cookies.delete(googleCookieNames.state, { path: oauthCookieOptions.path });
	context.cookies.delete(googleCookieNames.codeVerifier, { path: oauthCookieOptions.path });

	if (context.url.searchParams.has("error")) {
		return restart(context);
	}

	if (storedState === null || codeVerifier === null || code === null || state === null) {
		return restart(context, "expired");
	}

	if (storedState !== state) {
		return restart(context, "expired");
	}

	let providerAccount: ProviderAccount;
	try {
		providerAccount = await google.authorize(code, codeVerifier);
	} catch (error) {
		if (error instanceof InvalidIdTokenError) {
			console.error("Google sign-in returned an invalid ID token:", error.message);
		}

		return restart(context, "failed");
	}

	const db = context.locals.db;
	const signIn = await db.accounts.signIn(providerAccount);

	switch (signIn.status) {
		case "banned":
			return restart(context, "banned");
		case "email-taken":
			return new Response(
				"An account with this email already exists. Sign in with the method you used before.",
				{ status: 409 },
			);
	}

	const session = await createSession(signIn.user.id, db);
	setSessionTokenCookie(context.cookies, session.token, session.lastVerifiedAt);

	return context.redirect("/");
}
