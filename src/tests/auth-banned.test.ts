import { describe, expect, it } from "vitest";
import { createSession, getSession } from "@src/auth/session";
import { signInWithProviderAccount, UserBannedError } from "@src/auth/sign-in";
import { sessions } from "@src/db/schema";
import { createTestDatabase, insertUser } from "@src/tests/database";

describe("a banned user", () => {
	it("cannot sign in again", async () => {
		const { client, db } = createTestDatabase("banned-sign-in");
		const admin = insertUser(client, "admin", "admin");
		const googleAccount = {
			providerId: "google",
			accountId: "google-sub-1",
			fullname: "Ada Lovelace",
			email: "ada@example.com",
			emailVerified: true,
		};
		const user = await signInWithProviderAccount(db, googleAccount);
		await db.mutations.users.ban(admin.id, user.username);

		await expect(signInWithProviderAccount(db, googleAccount)).rejects.toBeInstanceOf(UserBannedError);
	});

	it("loses a session created after the ban", async () => {
		const { client, db } = createTestDatabase("banned-session");
		const admin = insertUser(client, "admin", "admin");
		const bob = insertUser(client, "bob");
		await db.mutations.users.ban(admin.id, bob.username);
		const session = await createSession(bob.id, db);

		expect(await getSession(session.id, db)).toBeNull();
		expect(await client.$count(sessions)).toBe(0);
	});
});
