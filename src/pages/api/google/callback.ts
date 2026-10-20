import { google, googleCookieNames, InvalidIdTokenError } from "@src/auth/providers/google";
import { oauthCookieOptions } from "@src/auth/oauth";
import {
	EmailAlreadyRegisteredError,
	signInWithProviderAccount,
} from "@src/auth/sign-in";
import type { ProviderAccount } from "@src/auth/provider-account";
import { createSession, setSessionTokenCookie } from "@src/auth/session";
import type { User } from "@src/db/schema";

import type { APIContext } from "astro";

function restartResponse(): Response {
	return new Response("Please restart the process.", { status: 400 });
}

export async function GET(context: APIContext): Promise<Response> {
	const storedState = context.cookies.get(googleCookieNames.state)?.value ?? null;
	const codeVerifier = context.cookies.get(googleCookieNames.codeVerifier)?.value ?? null;
	const code = context.url.searchParams.get("code");
	const state = context.url.searchParams.get("state");

	// The state and verifier are single use, whether or not the callback succeeds.
	context.cookies.delete(googleCookieNames.state, { path: oauthCookieOptions.path });
	context.cookies.delete(googleCookieNames.codeVerifier, { path: oauthCookieOptions.path });

	if (storedState === null || codeVerifier === null || code === null || state === null) {
		return restartResponse();
	}

	if (storedState !== state) {
		return restartResponse();
	}

	let providerAccount: ProviderAccount;
	try {
		providerAccount = await google.authorize(code, codeVerifier);
	} catch (error) {
		// A rejected ID token usually means the client id or issuer is misconfigured.
		if (error instanceof InvalidIdTokenError) {
			console.error("Google sign-in returned an invalid ID token:", error.message);
		}

		return restartResponse();
	}

	const db = context.locals.db;

	let user: User;
	try {
		user = await signInWithProviderAccount(db, providerAccount);
	} catch (error) {
		if (error instanceof EmailAlreadyRegisteredError) {
			return new Response(
				"An account with this email already exists. Sign in with the method you used before.",
				{ status: 409 },
			);
		}

		throw error;
	}

	const session = await createSession(user.id, db);
	setSessionTokenCookie(context.cookies, session.token, session.lastVerifiedAt);

	return context.redirect("/");
}
