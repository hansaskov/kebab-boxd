import { GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, GOOGLE_REDIRECT_URI } from "astro:env/server";
import { z } from "astro/zod";
import { base64UrlDecode } from "@src/auth/hash";
import { createS256CodeChallenge } from "@src/auth/oauth";
import type { ProviderAccount } from "@src/auth/provider-account";

const GOOGLE_ISSUERS: ReadonlySet<string> = new Set([
	"https://accounts.google.com",
	"accounts.google.com",
]);

const GoogleIdTokenClaimsSchema = z.object({
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

export function parseGoogleIdToken(idToken: string, clientId: string): ProviderAccount {
	const claims = GoogleIdTokenClaimsSchema.safeParse(decodeIdTokenPayload(idToken));

	if (!claims.success) {
		throw new InvalidIdTokenError("The ID token is missing required claims.");
	}

	if (claims.data.aud !== clientId) {
		throw new InvalidIdTokenError("The ID token was issued for another client.");
	}

	if (!GOOGLE_ISSUERS.has(claims.data.iss)) {
		throw new InvalidIdTokenError("The ID token was issued by another provider.");
	}

	if (!claims.data.email_verified) {
		throw new InvalidIdTokenError("The provider has not verified this email address.");
	}

	return {
		providerId: "google",
		accountId: claims.data.sub,
		fullname: claims.data.name,
		email: claims.data.email,
		emailVerified: true,
	};
}

const authorizationEndpoint = "https://accounts.google.com/o/oauth2/v2/auth";
const tokenEndpoint = "https://oauth2.googleapis.com/token";
const scopes = ["openid", "profile", "email"];

/** Cookie names shared by the authorization request and its callback. */
export const googleCookieNames = {
	state: "google_oauth_state",
	codeVerifier: "google_code_verifier",
} as const;

interface GoogleTokenResponse {
	id_token: string;
	access_token: string;
	token_type: string;
	expires_in: number;
	refresh_token?: string;
	scope?: string;
}

class GoogleOAuthClient {
	constructor(
		private clientId: string,
		private clientSecret: string,
		private redirectURI: string,
	) {}

	createAuthorizationURL(state: string, codeVerifier: string): URL {
		const url = new URL(authorizationEndpoint);
		url.searchParams.set("response_type", "code");
		url.searchParams.set("client_id", this.clientId);
		url.searchParams.set("redirect_uri", this.redirectURI);
		url.searchParams.set("state", state);
		url.searchParams.set("code_challenge_method", "S256");
		url.searchParams.set("code_challenge", createS256CodeChallenge(codeVerifier));
		url.searchParams.set("scope", scopes.join(" "));
		return url;
	}

	async validateAuthorizationCode(code: string, codeVerifier: string): Promise<GoogleTokenResponse> {
		const body = new URLSearchParams();
		body.set("grant_type", "authorization_code");
		body.set("code", code);
		body.set("redirect_uri", this.redirectURI);
		body.set("code_verifier", codeVerifier);

		const credentials = Buffer.from(`${this.clientId}:${this.clientSecret}`).toString("base64");
		const response = await fetch(tokenEndpoint, {
			method: "POST",
			headers: {
				"Content-Type": "application/x-www-form-urlencoded",
				Accept: "application/json",
				Authorization: `Basic ${credentials}`,
			},
			body,
		});

		if (!response.ok) {
			throw new Error(`Token endpoint returned status ${response.status}`);
		}

		return (await response.json()) as GoogleTokenResponse;
	}

	async authorize(code: string, codeVerifier: string): Promise<ProviderAccount> {
		const tokens = await this.validateAuthorizationCode(code, codeVerifier);

		return parseGoogleIdToken(tokens.id_token, this.clientId);
	}
}

export const google = new GoogleOAuthClient(
	GOOGLE_CLIENT_ID,
	GOOGLE_CLIENT_SECRET,
	GOOGLE_REDIRECT_URI,
);
