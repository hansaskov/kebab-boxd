import { describe, expect, it } from "vitest";
import { eq, getColumns, getTableName, is, SQL, Table } from "drizzle-orm";
import { SQLiteTimestamp } from "drizzle-orm/sqlite-core";
import { createSession } from "@src/auth/session";
import * as schema from "@src/db/schema";
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

	it("leaves every automatic timestamp for SQLite to compute when the statement runs", () => {
		// A value computed in JavaScript would be fixed once, when a prepared statement is built.
		const computedInJavaScript = Object.values(schema)
			.filter((table) => is(table, Table))
			.flatMap((table) =>
				Object.values(getColumns(table))
					.filter((column) => is(column, SQLiteTimestamp))
					.flatMap((column) =>
						[column.defaultFn, column.onUpdateFn]
							.filter((fn) => fn !== undefined)
							.filter((fn) => !is(fn(), SQL))
							.map(() => `${getTableName(table)}.${column.name}`),
					),
			);

		expect(computedInJavaScript).toEqual([]);
	});

	it("stores the time of the write in updatedAt", async () => {
		const { client, db } = createTestDatabase("api-updated-at");
		const user = insertUser(client, "ada");
		const session = await createSession(user.id, db);
		const yesterday = new Date(Date.now() - day);
		client.update(sessions).set({ createdAt: yesterday, updatedAt: yesterday }).where(eq(sessions.id, session.id)).run();

		// Timestamps are stored in whole seconds.
		const startOfWrite = Math.floor(Date.now() / 1000) * 1000;
		await db.mutations.sessions.setTheme(session.id, "dark");

		const row = client.select().from(sessions).where(eq(sessions.id, session.id)).get();
		expect(row!.updatedAt.getTime()).toBeGreaterThanOrEqual(startOfWrite);
		expect(row!.updatedAt.getTime()).toBeLessThanOrEqual(Date.now());
		expect(row!.createdAt.getTime()).toBe(Math.floor(yesterday.getTime() / 1000) * 1000);
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
