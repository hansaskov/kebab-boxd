import { google, googleCookieNames, InvalidIdTokenError } from "@src/auth/providers/google";
import { oauthCookieOptions } from "@src/auth/oauth";
import {
	EmailAlreadyRegisteredError,
	signInWithProviderAccount,
	UserBannedError,
} from "@src/auth/sign-in";
import type { ProviderAccount } from "@src/auth/provider-account";
import { createSession, setSessionTokenCookie } from "@src/auth/session";
import type { User } from "@src/db/schema";

import type { APIContext } from "astro";

/** Sends the person back to the login page, which explains the reason, if any. */
function restart(context: APIContext, reason?: "expired" | "failed" | "banned"): Response {
	return context.redirect(reason ? `/login?error=${reason}` : "/login");
}

export async function GET(context: APIContext): Promise<Response> {
	const storedState = context.cookies.get(googleCookieNames.state)?.value ?? null;
	const codeVerifier = context.cookies.get(googleCookieNames.codeVerifier)?.value ?? null;
	const code = context.url.searchParams.get("code");
	const state = context.url.searchParams.get("state");

	// The state and verifier are single use, whether or not the callback succeeds.
	context.cookies.delete(googleCookieNames.state, { path: oauthCookieOptions.path });
	context.cookies.delete(googleCookieNames.codeVerifier, { path: oauthCookieOptions.path });

	// Google adds an error, such as access_denied, when the person cancels.
	if (context.url.searchParams.has("error")) {
		return restart(context);
	}

	// The cookies are gone or belong to a newer attempt, for example after going
	// back to an old account picker.
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
		// A rejected ID token usually means the client id or issuer is misconfigured.
		if (error instanceof InvalidIdTokenError) {
			console.error("Google sign-in returned an invalid ID token:", error.message);
		}

		return restart(context, "failed");
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

		if (error instanceof UserBannedError) {
			return restart(context, "banned");
		}

		throw error;
	}

	const session = await createSession(user.id, db);
	setSessionTokenCookie(context.cookies, session.token, session.lastVerifiedAt);

	return context.redirect("/");
}
