import { App } from "astro/app";
import { describe, expect, it } from "vitest";
import { base64UrlEncode, hashSecret } from "@src/auth/hash";
import { googleCookieNames } from "@src/auth/providers/google";
import * as StartEndpoint from "@src/pages/api/google/index";
import * as CallbackEndpoint from "@src/pages/api/google/callback";
import { requestEndpoint } from "@src/tests/container";
import { createTestDatabase } from "@src/tests/database";

// The cookies as the server adapter sends them.
function cookiesOf(response: Response) {
	return new Map([...App.getSetCookieFromResponse(response)].map((cookie) => {
		const [pair = ""] = cookie.split(";");
		const separator = pair.indexOf("=");
		return [pair.slice(0, separator), pair.slice(separator + 1)];
	}));
}

async function callback(query: string, cookie = "") {
	const { db } = createTestDatabase();
	const response = await requestEndpoint(CallbackEndpoint, { db, session: null }, `/api/google/callback?${query}`, {}, { cookie });
	return { location: response.headers.get("Location"), cookies: cookiesOf(response) };
}

describe("signing in with Google", () => {
	it("starts at Google with a state and a code challenge that only this browser can answer", async () => {
		const { db } = createTestDatabase();

		const response = await requestEndpoint(StartEndpoint, { db, session: null }, "/api/google");
		const location = new URL(response.headers.get("Location")!);
		const cookies = cookiesOf(response);

		expect(location.origin).toBe("https://accounts.google.com");
		expect(location.searchParams.get("state")).toBe(cookies.get(googleCookieNames.state));
		expect(location.searchParams.get("code_challenge")).toBe(base64UrlEncode(hashSecret(cookies.get(googleCookieNames.codeVerifier)!)));
	});

	it("sends the user back to sign in again when the attempt is not the one their browser started", async () => {
		const cookie = `${googleCookieNames.state}=ours; ${googleCookieNames.codeVerifier}=verifier`;

		expect((await callback("code=c&state=ours")).location).toBe("/login?error=expired");
		expect((await callback("code=c&state=theirs", cookie)).location).toBe("/login?error=expired");
	});

	it("sends the user back without an error when they said no at Google, and ends the attempt either way", async () => {
		const cookie = `${googleCookieNames.state}=ours; ${googleCookieNames.codeVerifier}=verifier`;

		const { location, cookies } = await callback("error=access_denied&state=ours", cookie);

		expect(location).toBe("/login");
		expect(cookies.get(googleCookieNames.state)).toBe("deleted");
		expect(cookies.get(googleCookieNames.codeVerifier)).toBe("deleted");
	});
});
