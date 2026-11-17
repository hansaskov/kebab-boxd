import { App } from "astro/app";
import { describe, expect, it } from "vitest";
import { base64UrlEncode, hashSecret } from "@src/auth/hash";
import { returnPathCookieName } from "@src/auth/oauth";
import { googleCookieNames } from "@src/auth/providers/google";
import * as StartEndpoint from "@src/pages/api/google/index";
import * as CallbackEndpoint from "@src/pages/api/google/callback";
import { requestEndpoint } from "@src/tests/container";
import { createTestDatabase } from "@src/tests/database";
import { parseReturnPath } from "@src/auth/return-path";

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

		expect((await callback("code=c&state=ours")).location).toBe("/login?reason=expired");
		expect((await callback("code=c&state=theirs", cookie)).location).toBe("/login?reason=expired");
	});

	it("never sends the user away from Kebab Boxd, nor back to the landing page or the sign-in page", async () => {
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
				"/.//evil.example",
				"/..//evil.example",
				"/%2e//evil.example",
				"/a/..//evil.example",
			].map(parseReturnPath),
		).toEqual(["/restaurants/1?page=2", ...Array<undefined>(12).fill(undefined)]);
	});
});
