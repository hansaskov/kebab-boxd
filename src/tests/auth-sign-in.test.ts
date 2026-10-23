import { describe, expect, it } from "vitest";
import { accounts, users } from "@src/db/schema";
import { EmailAlreadyRegisteredError, signInWithProviderAccount } from "@src/auth/sign-in";
import type { ProviderAccount } from "@src/auth/provider-account";
import { usernameSchema } from "@src/validation/username";
import { createTestDatabase, insertUser } from "@src/tests/database";

function googleAccount(overrides: Partial<ProviderAccount> = {}): ProviderAccount {
	return {
		providerId: "google",
		accountId: "google-sub-1",
		fullname: "Ada Lovelace",
		email: "ada@example.com",
		emailVerified: true,
		...overrides,
	};
}

describe("signInWithProviderAccount", () => {
	it("returns the existing user when the same provider account signs in again", async () => {
		const { client, db } = createTestDatabase("sign-in-repeat");

		const first = await signInWithProviderAccount(db, googleAccount());
		const second = await signInWithProviderAccount(db, googleAccount());

		expect(second.id).toBe(first.id);
		expect(await client.$count(users)).toBe(1);
		expect(await client.$count(accounts)).toBe(1);
	});

	it("refuses to attach a second provider to an email that is already registered", async () => {
		const { client, db } = createTestDatabase("sign-in-email-conflict");
		await signInWithProviderAccount(db, googleAccount());

		await expect(
			signInWithProviderAccount(db, googleAccount({ providerId: "github", accountId: "github-sub-1", email: "ADA@example.com" })),
		).rejects.toBeInstanceOf(EmailAlreadyRegisteredError);

		expect(await client.$count(users)).toBe(1);
		expect(await client.$count(accounts)).toBe(1);
	});

	it("generates a username that passes the settings validation", async () => {
		const { db } = createTestDatabase("sign-in-valid-username");

		const result = await signInWithProviderAccount(db, googleAccount({ fullname: "Søren-Émile O'Brien" }));

		expect(usernameSchema.parse(result.username)).toBe(result.username);
	});

	it("gives the new user another username when the preferred one is taken", async () => {
		const { client, db } = createTestDatabase("sign-in-username-taken");
		insertUser(client, "ada_2");

		const result = await signInWithProviderAccount(db, googleAccount());

		expect(result.id).toBe(2);
		expect(result.username).not.toBe("ada_2");
		expect(result.username).toMatch(/^ada_/);
		expect(await db.queries.users.findByUsername(result.username)).toMatchObject({ id: result.id });
	});
});
