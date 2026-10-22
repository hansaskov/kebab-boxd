import { describe, expect, it } from "vitest";
import { createSession, getSession } from "@src/auth/session";
import { signInWithProviderAccount, UserBannedError } from "@src/auth/sign-in";
import type { ProviderAccount } from "@src/auth/provider-account";
import { sessions } from "@src/db/schema";
import { can } from "@src/auth/permissions";
import { banAs, createTestDatabase, insertUser } from "@src/tests/database";

const googleAccount: ProviderAccount = {
	providerId: "google",
	accountId: "google-sub-1",
	fullname: "Ada Lovelace",
	email: "ada@example.com",
	emailVerified: true,
};

describe("a banned user", () => {
	it("cannot sign in again", async () => {
		const { client, db } = createTestDatabase("banned-sign-in");
		const admin = insertUser(client, "admin", "admin");
		const user = await signInWithProviderAccount(db, googleAccount);
		await banAs(db, admin.id, user.id);

		await expect(signInWithProviderAccount(db, googleAccount)).rejects.toBeInstanceOf(UserBannedError);
	});

	it("is told about the ban when signing in with another provider account with the same email", async () => {
		const { client, db } = createTestDatabase("banned-sign-in-other-account");
		const admin = insertUser(client, "admin", "admin");
		const user = await signInWithProviderAccount(db, googleAccount);
		await banAs(db, admin.id, user.id);

		await expect(
			signInWithProviderAccount(db, { ...googleAccount, accountId: "google-sub-2", email: "ADA@example.com" }),
		).rejects.toBeInstanceOf(UserBannedError);
	});

	it("can sign in again once the ban is lifted", async () => {
		const { client, db } = createTestDatabase("banned-sign-in-lifted");
		const admin = insertUser(client, "admin", "admin");
		const user = await signInWithProviderAccount(db, googleAccount);
		await banAs(db, admin.id, user.id);
		await db.mutations.users.unban(user.id, admin.id, (actor, target) => can(actor, "user:ban", target));

		expect((await signInWithProviderAccount(db, googleAccount)).id).toBe(user.id);
	});

	it("loses a session created after the ban", async () => {
		const { client, db } = createTestDatabase("banned-session");
		const admin = insertUser(client, "admin", "admin");
		const bob = insertUser(client, "bob");
		await banAs(db, admin.id, bob.id);
		const session = await createSession(bob.id, db);

		expect(await getSession(session.id, db)).toBeNull();
		expect(await client.$count(sessions)).toBe(0);
	});
});
