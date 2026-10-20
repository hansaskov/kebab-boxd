import { google, googleCookieNames } from "@src/auth/providers/google";
import { generateCodeVerifier, generateState, oauthCookieOptions } from "@src/auth/oauth";

import type { APIContext } from "astro";

export async function GET(context: APIContext): Promise<Response> {
  const state = generateState();
  const codeVerifier = generateCodeVerifier();
  const url = google.createAuthorizationURL(state, codeVerifier);
  url.searchParams.set("prompt", "select_account");

  context.cookies.set(googleCookieNames.state, state, oauthCookieOptions);
  context.cookies.set(googleCookieNames.codeVerifier, codeVerifier, oauthCookieOptions);

  return context.redirect(url.toString());
}
