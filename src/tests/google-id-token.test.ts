import { describe, expect, it } from "vitest";
import { base64UrlEncode } from "@src/auth/hash";
import { InvalidIdTokenError, parseGoogleIdToken } from "@src/auth/providers/google";

const clientId = "test-client-id";

function encodePart(value: unknown): string {
	return base64UrlEncode(new TextEncoder().encode(JSON.stringify(value)));
}

function idToken(overrides: Record<string, unknown> = {}): string {
	const claims = {
		sub: "google-sub-1",
		name: "Ada Lovelace",
		email: "ada@example.com",
		email_verified: true,
		aud: clientId,
		iss: "https://accounts.google.com",
		...overrides,
	};
	return `${encodePart({ alg: "RS256", typ: "JWT" })}.${encodePart(claims)}.signature`;
}

describe("a Google ID token", () => {
	it("gives the Account it vouches for", () => {
		expect(parseGoogleIdToken(idToken(), clientId)).toEqual({
			providerId: "google",
			accountId: "google-sub-1",
			fullname: "Ada Lovelace",
			email: "ada@example.com",
			emailVerified: true,
		});
	});

	it.each([
		["another client", { aud: "someone-else" }],
		["another issuer", { iss: "https://example.com" }],
		["an unverified email address", { email_verified: false }],
	])("is refused when it is for %s", (_, overrides) => {
		expect(() => parseGoogleIdToken(idToken(overrides), clientId)).toThrow(InvalidIdTokenError);
	});
});
