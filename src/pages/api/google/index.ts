// pages/login/google/index.ts
import { generateCodeVerifier, generateState } from "arctic";
import { google } from "@auth/oauth";

import type { APIContext } from "astro";

export async function GET(context: APIContext): Promise<Response> {
	const state = generateState();
	const codeVerifier = generateCodeVerifier();
    const scopes = ["openid", "profile", "email"];
	const url = google.createAuthorizationURL(state, codeVerifier, scopes);
	url.searchParams.set("prompt", "select_account");

	context.cookies.set("google_oauth_state", state, {
		path: "/",
		secure: import.meta.env.PROD,
		httpOnly: true,
		maxAge: 60 * 10, // 10 minutes
		sameSite: "lax"
	});
	context.cookies.set("google_code_verifier", codeVerifier, {
		path: "/",
		secure: import.meta.env.PROD,
		httpOnly: true,
		maxAge: 60 * 10, // 10 minutes
		sameSite: "lax"
	});

	return context.redirect(url.toString());
}
