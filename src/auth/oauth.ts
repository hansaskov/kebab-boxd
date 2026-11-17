import type { AstroCookies } from "astro";
import { base64UrlEncode, generateBase64UrlRandomString, hashSecret } from "@src/auth/hash";
import { parseReturnPath } from "@src/auth/return-path";

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

export const returnPathCookieName = "sign_in_return_path";

export function rememberReturnPath(cookies: AstroCookies, returnPath: string | undefined) {
	if (returnPath) cookies.set(returnPathCookieName, returnPath, cookieOptions);
	else cookies.delete(returnPathCookieName, { path: cookieOptions.path });
}

export function takeReturnPath(cookies: AstroCookies): string | undefined {
	const returnPath = parseReturnPath(cookies.get(returnPathCookieName)?.value);
	cookies.delete(returnPathCookieName, { path: cookieOptions.path });
	return returnPath;
}

export function beginAuthorization(cookies: AstroCookies, providerId: string) {
	const names = authorizationCookieNames(providerId);
	const state = generateBase64UrlRandomString();
	const codeVerifier = generateBase64UrlRandomString();
	cookies.set(names.state, state, cookieOptions);
	cookies.set(names.codeVerifier, codeVerifier, cookieOptions);
	return { state, codeChallenge: base64UrlEncode(hashSecret(codeVerifier)) };
}

export type AuthorizationFailure = "cancelled" | "expired";

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
