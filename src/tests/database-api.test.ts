import { describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { createSession } from "@src/auth/session";
import { accounts, sessions, users } from "@src/db/schema";
import { createTestDatabase, insertUser } from "@src/tests/database";

const day = 24 * 60 * 60 * 1000;

describe("database API", () => {
	it("compares dates with the active-session cutoff the way the column stores them", async () => {
		const { client, db } = createTestDatabase("api-active-sessions");
		const user = insertUser(client, "ada");
		const active = await createSession(user.id, db);
		const timedOut = await createSession(user.id, db);
		client
			.update(sessions)
			.set({ lastVerifiedAt: new Date(Date.now() - 31 * day) })
			.where(eq(sessions.id, timedOut.id))
			.run();

		const listed = await db.queries.sessions.listActive(user.id);

		expect(listed.map((session) => session.id)).toEqual([active.id]);
		const page = { username: user.username, cursor: {}, limit: 25 };
		expect(await db.queries.sessions.findActiveWithHistory({ ...page, sessionId: active.id })).toBeDefined();
		expect(await db.queries.sessions.findActiveWithHistory({ ...page, sessionId: timedOut.id })).toBeUndefined();
	});

	it("stores the time of each write, not the time its statement was prepared", async () => {
		const { client, db } = createTestDatabase("api-timestamps");
		const user = insertUser(client, "ada");
		const first = await createSession(user.id, db);
		// Timestamps are stored in whole seconds.
		await new Promise((resolve) => setTimeout(resolve, 1100));
		const second = await createSession(user.id, db);
		await db.mutations.sessions.setTheme(first.id, "dark");

		const rows = client.select().from(sessions).all();
		const firstRow = rows.find((row) => row.id === first.id);
		const secondRow = rows.find((row) => row.id === second.id);

		expect(secondRow!.createdAt.getTime()).toBeGreaterThan(firstRow!.createdAt.getTime());
		expect(firstRow!.updatedAt.getTime()).toBeGreaterThan(firstRow!.createdAt.getTime());
	});

	it("creates no user when creating the account fails part way", async () => {
		const { client, db } = createTestDatabase("api-create-account-rollback");
		const bob = insertUser(client, "bob");
		client.insert(accounts).values({ userId: bob.id, providerId: "google", accountId: "google-sub-1" }).run();

		// The user is inserted, then the account clashes with Bob's.
		await expect(
			db.mutations.accounts.createWithUser({
				providerId: "google",
				accountId: "google-sub-1",
				fullname: "Ada Lovelace",
				email: "ada@example.com",
				emailVerified: true,
			}),
		).rejects.toThrow();

		expect(await client.$count(users)).toBe(1);
	});

	it("reports a username that another user has, ignoring letter case", async () => {
		const { client, db } = createTestDatabase("api-username-taken");
		const ada = insertUser(client, "ada");
		insertUser(client, "bob");
		const profile = { fullname: "Ada Lovelace", pronoun: null, bio: null };

		expect(await db.mutations.users.updateProfile(ada.id, { ...profile, username: "BOB" })).toBe("username-taken");
		expect(await db.mutations.users.updateProfile(ada.id, { ...profile, username: "ada_l" })).toBe("updated");
		expect((await db.queries.users.findByUsername("ada_l"))?.fullname).toBe("Ada Lovelace");
	});
});
