import { describe, expect, it } from "vitest";
import { createDrizzleDatabase, migrateDrizzleDatabase } from "@src/db";
import { accounts, users } from "@src/db/schema";
import {
	EmailAlreadyRegisteredError,
	signInWithProviderAccount,
} from "@src/auth/sign-in";
import type { ProviderAccount } from "@src/auth/provider-account";
import { usernameSchema } from "@src/validation/username";

function createTestDb(name: string) {
	const db = createDrizzleDatabase(`file:${name}?mode=memory`);
	migrateDrizzleDatabase(db);
	return db;
}

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
		const db = createTestDb("sign-in-repeat");

		const first = await signInWithProviderAccount(db, googleAccount());
		const second = await signInWithProviderAccount(db, googleAccount());

		expect(second.id).toBe(first.id);
		expect(await db.$count(users)).toBe(1);
		expect(await db.$count(accounts)).toBe(1);
	});

	it("refuses to attach a second provider to an email that is already registered", async () => {
		const db = createTestDb("sign-in-email-conflict");

		await signInWithProviderAccount(db, googleAccount());

		await expect(
			signInWithProviderAccount(
				db,
				googleAccount({ providerId: "github", accountId: "github-sub-1" }),
			),
		).rejects.toBeInstanceOf(EmailAlreadyRegisteredError);

		expect(await db.$count(users)).toBe(1);
		expect(await db.$count(accounts)).toBe(1);
	});

	it("generates a username that passes the settings validation", async () => {
		const db = createTestDb("sign-in-valid-username");

		const result = await signInWithProviderAccount(
			db,
			googleAccount({ fullname: "Søren-Émile O'Brien" }),
		);

		expect(result.username).toMatch(/^[a-z0-9_]+$/);
		expect(usernameSchema.safeParse(result.username).success).toBe(true);
	});

	it("picks another username when the id-based one is already taken", async () => {
		const db = createTestDb("sign-in-username-taken");
		db.insert(users)
			.values({ fullname: "Squatter", username: "ada_2", email: "squatter@example.com" })
			.run();

		const result = await signInWithProviderAccount(db, googleAccount());

		expect(result.id).toBe(2);
		expect(result.username).not.toBe("ada_2");
		expect(result.username).toMatch(/^ada_[a-z0-9]+$/);
		expect(result.username.length).toBeLessThanOrEqual(30);
	});
});
