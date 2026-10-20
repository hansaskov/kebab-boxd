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
	it("creates a user and a linked account for a new provider account", async () => {
		const db = createTestDb("sign-in-new");

		const result = await signInWithProviderAccount(db, googleAccount());

		expect(result.email).toBe("ada@example.com");
		expect(result.emailVerified).toBe(true);

		const account = await db.query.accounts.findFirst({
			with: { user: true },
			where: { providerId: "google", accountId: "google-sub-1" },
		});

		expect(account).toBeDefined();
		expect(account?.userId).toBe(result.id);
		expect(account?.user.username).toBe(result.username);

		const userWithAccounts = await db.query.users.findFirst({
			with: { accounts: true },
			where: { id: result.id },
		});

		expect(userWithAccounts?.accounts).toHaveLength(1);
	});

	it("normalizes the email address", async () => {
		const db = createTestDb("sign-in-email-normalize");

		const result = await signInWithProviderAccount(
			db,
			googleAccount({ email: " Ada@Example.COM " }),
		);

		expect(result.email).toBe("ada@example.com");
	});

	it("returns the existing user when the same provider account signs in again", async () => {
		const db = createTestDb("sign-in-repeat");

		const first = await signInWithProviderAccount(db, googleAccount());
		const second = await signInWithProviderAccount(db, googleAccount());

		expect(second.id).toBe(first.id);
		expect(await db.$count(users)).toBe(1);
		expect(await db.$count(accounts)).toBe(1);
	});

	it("treats the same account id from different providers as separate accounts", async () => {
		const db = createTestDb("sign-in-providers");

		const google = await signInWithProviderAccount(
			db,
			googleAccount({ accountId: "shared-id" }),
		);
		const github = await signInWithProviderAccount(
			db,
			googleAccount({
				providerId: "github",
				accountId: "shared-id",
				email: "ada@github.example",
			}),
		);

		expect(github.id).not.toBe(google.id);
		expect(await db.$count(accounts)).toBe(2);
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

	it("marks an existing account as email verified once the provider confirms it", async () => {
		const db = createTestDb("sign-in-verify-email");

		const first = await signInWithProviderAccount(
			db,
			googleAccount({ emailVerified: false }),
		);
		expect(first.emailVerified).toBe(false);

		const second = await signInWithProviderAccount(db, googleAccount());

		expect(second.emailVerified).toBe(true);
		const stored = await db.query.users.findFirst({ where: { id: first.id } });
		expect(stored?.emailVerified).toBe(true);
	});

	it("derives a distinct username from the first name", async () => {
		const db = createTestDb("sign-in-usernames");

		const first = await signInWithProviderAccount(db, googleAccount());
		const second = await signInWithProviderAccount(
			db,
			googleAccount({ accountId: "google-sub-2", email: "ada2@example.com" }),
		);

		expect(first.username).toMatch(/^ada_\d+$/);
		expect(second.username).toMatch(/^ada_\d+$/);
		expect(second.username).not.toBe(first.username);
	});

	it("keeps a generated username within the settings length limit", async () => {
		const db = createTestDb("sign-in-long-name");

		const result = await signInWithProviderAccount(
			db,
			googleAccount({ fullname: `${"A".repeat(80)} Smith` }),
		);

		expect(result.username.length).toBeLessThanOrEqual(30);
		expect(result.username).toMatch(/_\d+$/);
	});

	it("falls back to a usable username when the provider name is blank", async () => {
		const db = createTestDb("sign-in-blank-name");

		const result = await signInWithProviderAccount(
			db,
			googleAccount({ fullname: "   " }),
		);

		expect(result.username).toMatch(/^kebab_\d+$/);
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
