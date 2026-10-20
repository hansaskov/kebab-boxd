import { describe, expect, it } from "vitest";
import { InvalidIdTokenError, parseGoogleIdToken } from "@src/auth/providers/google";
import { base64UrlEncode } from "@src/auth/hash";

const clientId = "test-client-id";

function encodePart(value: unknown): string {
	return base64UrlEncode(new TextEncoder().encode(JSON.stringify(value)));
}

function createIdToken(claims: Record<string, unknown>): string {
	return `${encodePart({ alg: "RS256", typ: "JWT" })}.${encodePart(claims)}.signature`;
}

function validClaims(overrides: Record<string, unknown> = {}): Record<string, unknown> {
	return {
		sub: "google-sub-1",
		name: "Ada Lovelace",
		email: "ada@example.com",
		email_verified: true,
		aud: clientId,
		iss: "https://accounts.google.com",
		...overrides,
	};
}

describe("parseGoogleIdToken", () => {
	it("returns a provider account from valid claims", () => {
		const providerAccount = parseGoogleIdToken(createIdToken(validClaims()), clientId);

		expect(providerAccount).toEqual({
			providerId: "google",
			accountId: "google-sub-1",
			fullname: "Ada Lovelace",
			email: "ada@example.com",
			emailVerified: true,
		});
	});

	it("accepts the issuer variant without the URL scheme", () => {
		const token = createIdToken(validClaims({ iss: "accounts.google.com" }));

		expect(() => parseGoogleIdToken(token, clientId)).not.toThrow();
	});

	it("rejects a token issued for another client", () => {
		const token = createIdToken(validClaims({ aud: "someone-else" }));

		expect(() => parseGoogleIdToken(token, clientId)).toThrow(InvalidIdTokenError);
	});

	it("rejects a token from another issuer", () => {
		const token = createIdToken(validClaims({ iss: "https://example.com" }));

		expect(() => parseGoogleIdToken(token, clientId)).toThrow(InvalidIdTokenError);
	});

	it("rejects an unverified email address", () => {
		const token = createIdToken(validClaims({ email_verified: false }));

		expect(() => parseGoogleIdToken(token, clientId)).toThrow(InvalidIdTokenError);
	});

	it("rejects malformed tokens", () => {
		expect(() => parseGoogleIdToken("not-a-token", clientId)).toThrow(
			InvalidIdTokenError,
		);
		expect(() =>
			parseGoogleIdToken(createIdToken({ sub: "only-a-subject" }), clientId),
		).toThrow(InvalidIdTokenError);
	});
});
