import { App } from "astro/app";
import { describe, expect, it } from "vitest";
import { base64UrlEncode, hashSecret } from "@src/auth/hash";
import { returnPathCookieName } from "@src/auth/oauth";
import { googleCookieNames } from "@src/auth/providers/google";
import * as StartEndpoint from "@src/pages/api/google/index";
import * as CallbackEndpoint from "@src/pages/api/google/callback";
import LoginPage from "@src/pages/login.astro";
import { renderPage, requestEndpoint } from "@src/tests/container";
import { createTestDatabase, insertUser, signIn } from "@src/tests/database";
import { parseReturnPath } from "@src/validation/return-path";

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

	it("brings the user back to the page they signed in from, also when they have to try again", async () => {
		const { db } = createTestDatabase();
		const attempt = `${googleCookieNames.state}=ours; ${googleCookieNames.codeVerifier}=verifier`;
		const returnPath = `${returnPathCookieName}=${encodeURIComponent("/restaurants/1")}`;

		const started = cookiesOf(await requestEndpoint(StartEndpoint, { db, session: null }, "/api/google?next=%2Frestaurants%2F1"));
		const cancelled = await callback("error=access_denied&state=ours", `${attempt}; ${returnPath}`);
		const expired = await callback("code=c&state=theirs", `${attempt}; ${returnPath}`);

		expect(decodeURIComponent(started.get(returnPathCookieName)!)).toBe("/restaurants/1");
		expect(cancelled.location).toBe("/login?next=%2Frestaurants%2F1");
		expect(cancelled.cookies.get(returnPathCookieName)).toBe("deleted");
		expect(expired.location).toBe("/login?error=expired&next=%2Frestaurants%2F1");
	});

	it("never sends the user away from Kebab Boxd, nor back to the sign-in page", async () => {
		const { db } = createTestDatabase();

		const started = cookiesOf(await requestEndpoint(StartEndpoint, { db, session: null }, `/api/google?next=${encodeURIComponent("//evil.example/")}`));

		expect(started.get(returnPathCookieName)).toBe("deleted");
		expect(
			[
				"/restaurants/1?page=2#reviews",
				"/",
				"//evil.example",
				"/\\evil.example",
				"https://evil.example/",
				"restaurants/1",
				"/login?next=/",
				"/api/google",
				"",
				// Each leads to //evil.example once its dot segments are resolved.
				"/.//evil.example",
				"/..//evil.example",
				"/%2e//evil.example",
				"/a/..//evil.example",
			].map(parseReturnPath),
		).toEqual(["/restaurants/1?page=2", "/", ...Array<undefined>(11).fill(undefined)]);
	});

	it("passes the page to come back to on to Google, and sends a User who is signed in already straight to it", async () => {
		const { client, db } = createTestDatabase();
		const ada = insertUser(client, "ada");

		const visitor = (await renderPage(LoginPage, { db, session: null }, "/login?next=%2Fada%2Fprofile")).html;
		const signedIn = (await renderPage(LoginPage, { db, session: await signIn(db, ada.id) }, "/login?next=%2Fada%2Fprofile")).response;

		const toAnotherSite = (await renderPage(LoginPage, { db, session: await signIn(db, ada.id) }, "/login?next=%2F.%2F%2Fevil.example")).response;

		expect(visitor).toContain('href="/api/google?next=%2Fada%2Fprofile"');
		expect(signedIn.headers.get("Location")).toBe("/ada/profile");
		expect(toAnotherSite.headers.get("Location")).toBe("/");
	});
});
