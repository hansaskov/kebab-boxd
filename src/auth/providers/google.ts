import type { AstroCookies } from "astro";
import { GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, GOOGLE_REDIRECT_URI } from "astro:env/server";
import { z } from "astro/zod";
import { base64UrlDecode } from "@src/auth/hash";
import {
	authorizationCookieNames,
	beginAuthorization,
	endAuthorization,
	type AuthorizationFailure,
	type ProviderAccount,
} from "@src/auth/oauth";

const providerId = "google";
const authorizationEndpoint = "https://accounts.google.com/o/oauth2/v2/auth";
const tokenEndpoint = "https://oauth2.googleapis.com/token";
const scopes = ["openid", "profile", "email"];
const issuers: ReadonlySet<string> = new Set(["https://accounts.google.com", "accounts.google.com"]);

export const googleCookieNames = authorizationCookieNames(providerId);

const idTokenClaimsSchema = z.object({
	sub: z.string().min(1),
	name: z.string().min(1),
	email: z.email(),
	email_verified: z.boolean(),
	aud: z.string().min(1),
	iss: z.string().min(1),
});

export class InvalidIdTokenError extends Error {
	constructor(message: string) {
		super(message);
		this.name = "InvalidIdTokenError";
	}
}

function decodeIdTokenPayload(idToken: string): unknown {
	const parts = idToken.split(".");
	const payloadPart = parts.at(1);

	if (parts.length !== 3 || payloadPart === undefined) {
		throw new InvalidIdTokenError("The ID token is not a signed JWT.");
	}

	try {
		return JSON.parse(base64UrlDecode(payloadPart).toString("utf-8"));
	} catch {
		throw new InvalidIdTokenError("The ID token payload is not valid JSON.");
	}
}

// The signature is not checked: the token comes straight from Google over TLS, in answer to our own request.
export function parseGoogleIdToken(idToken: string, clientId: string): ProviderAccount {
	const claims = idTokenClaimsSchema.safeParse(decodeIdTokenPayload(idToken));

	if (!claims.success) {
		throw new InvalidIdTokenError("The ID token is missing required claims.");
	}

	if (claims.data.aud !== clientId) {
		throw new InvalidIdTokenError("The ID token was issued for another client.");
	}

	if (!issuers.has(claims.data.iss)) {
		throw new InvalidIdTokenError("The ID token was issued by another provider.");
	}

	if (!claims.data.email_verified) {
		throw new InvalidIdTokenError("The provider has not verified this email address.");
	}

	return {
		providerId,
		accountId: claims.data.sub,
		fullname: claims.data.name,
		email: claims.data.email,
		emailVerified: true,
	};
}

// Where to send the browser to sign in with Google. Google lets the user choose between their accounts.
export function googleAuthorizationUrl(cookies: AstroCookies): URL {
	const { state, codeChallenge } = beginAuthorization(cookies, providerId);
	const url = new URL(authorizationEndpoint);
	url.search = new URLSearchParams({
		response_type: "code",
		client_id: GOOGLE_CLIENT_ID,
		redirect_uri: GOOGLE_REDIRECT_URI,
		state,
		code_challenge_method: "S256",
		code_challenge: codeChallenge,
		scope: scopes.join(" "),
		prompt: "select_account",
	}).toString();
	return url;
}

async function redeemCode(code: string, codeVerifier: string): Promise<string> {
	const credentials = Buffer.from(`${GOOGLE_CLIENT_ID}:${GOOGLE_CLIENT_SECRET}`).toString("base64");
	const response = await fetch(tokenEndpoint, {
		method: "POST",
		headers: {
			"Content-Type": "application/x-www-form-urlencoded",
			Accept: "application/json",
			Authorization: `Basic ${credentials}`,
		},
		body: new URLSearchParams({ grant_type: "authorization_code", code, redirect_uri: GOOGLE_REDIRECT_URI, code_verifier: codeVerifier }),
	});
	if (!response.ok) throw new Error(`The token endpoint answered ${response.status}`);
	const { id_token: idToken } = (await response.json()) as { id_token: string };
	return idToken;
}

// The Account Google vouches for when it sends the browser back, or why there is none. "failed" means that Google
// could not be reached or sent something we cannot use; the cause is logged.
export async function finishGoogleSignIn(cookies: AstroCookies, callback: URL): Promise<ProviderAccount | AuthorizationFailure | "failed"> {
	const authorization = endAuthorization(cookies, providerId, callback);
	if (typeof authorization === "string") return authorization;

	try {
		return parseGoogleIdToken(await redeemCode(authorization.code, authorization.codeVerifier), GOOGLE_CLIENT_ID);
	} catch (error) {
		console.error("Google sign-in failed", error);
		return "failed";
	}
}
