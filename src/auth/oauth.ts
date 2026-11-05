import type { AstroCookies } from "astro";
import { base64UrlEncode, generateBase64UrlRandomString, hashSecret } from "@src/auth/hash";
import { parseReturnPath } from "@src/validation/return-path";

// The authorization code flow with PKCE that every Provider signs in through. Between the redirect to the Provider
// and its callback, the state and the code verifier wait in cookies that serve one attempt.

// What a Provider vouches for when a user signs in with it.
export interface ProviderAccount {
	providerId: string;
	accountId: string;
	fullname: string;
	email: string;
	emailVerified: boolean;
}

export const authorizationCookieMaxAgeSeconds = 60 * 10;

const cookieOptions = {
	path: "/",
	secure: import.meta.env.PROD,
	httpOnly: true,
	maxAge: authorizationCookieMaxAgeSeconds,
	sameSite: "lax",
} as const;

export function authorizationCookieNames(providerId: string) {
	return { state: `${providerId}_oauth_state`, codeVerifier: `${providerId}_code_verifier` };
}

// The page the user signs in from, whichever Provider they choose.
export const returnPathCookieName = "sign_in_return_path";

// Keeps the page to go back to for the attempt, or forgets the page of an earlier one.
export function rememberReturnPath(cookies: AstroCookies, returnPath: string | undefined) {
	if (returnPath) cookies.set(returnPathCookieName, returnPath, cookieOptions);
	else cookies.delete(returnPathCookieName, { path: cookieOptions.path });
}

// The page to go back to at the callback, which ends the attempt whether it succeeded or not.
export function takeReturnPath(cookies: AstroCookies): string | undefined {
	const returnPath = parseReturnPath(cookies.get(returnPathCookieName)?.value);
	cookies.delete(returnPathCookieName, { path: cookieOptions.path });
	return returnPath;
}

// Starts an attempt to sign in with the Provider. Returns what its authorization URL must carry.
export function beginAuthorization(cookies: AstroCookies, providerId: string) {
	const names = authorizationCookieNames(providerId);
	const state = generateBase64UrlRandomString();
	const codeVerifier = generateBase64UrlRandomString();
	cookies.set(names.state, state, cookieOptions);
	cookies.set(names.codeVerifier, codeVerifier, cookieOptions);
	return { state, codeChallenge: base64UrlEncode(hashSecret(codeVerifier)) };
}

// The user said no at the Provider, or the attempt is not the one this browser started: its cookies are gone, or
// the state does not match.
export type AuthorizationFailure = "cancelled" | "expired";

// Ends the attempt at the callback: the code the Provider sent, with the verifier that redeems it.
export function endAuthorization(
	cookies: AstroCookies,
	providerId: string,
	callback: URL,
): { code: string; codeVerifier: string } | AuthorizationFailure {
	const names = authorizationCookieNames(providerId);
	const state = cookies.get(names.state)?.value;
	const codeVerifier = cookies.get(names.codeVerifier)?.value;
	cookies.delete(names.state, { path: cookieOptions.path });
	cookies.delete(names.codeVerifier, { path: cookieOptions.path });

	const params = callback.searchParams;
	if (params.has("error")) return "cancelled";
	const code = params.get("code");
	if (!code || !state || !codeVerifier || params.get("state") !== state) return "expired";
	return { code, codeVerifier };
}
