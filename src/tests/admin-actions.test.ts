import { describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { server } from "@src/actions/index";
import { createSession } from "@src/auth/session";
import type { Client } from "@src/db/client";
import { sessions, users } from "@src/db/schema";
import { actionContext, form } from "@src/tests/actions";
import { createTestDatabase, insertUser, signIn } from "@src/tests/database";

function userRow(client: Client, id: number) {
	return client.select().from(users).where(eq(users.id, id)).get();
}

function sessionIdsOf(client: Client, userId: number) {
	return client.select({ id: sessions.id }).from(sessions).where(eq(sessions.userId, userId)).all().map((row) => row.id);
}

describe("banUser action", () => {
	it("bans a user and signs them out everywhere", async () => {
		const { client, db } = createTestDatabase("admin-ban");
		const admin = insertUser(client, "ada", "admin");
		const bob = insertUser(client, "bob");
		const adminSession = await signIn(db, admin.id);
		await createSession(bob.id, db);
		await createSession(bob.id, db);

		const result = await server.admin.banUser.call(actionContext(db, adminSession), form({ username: "bob" }));

		expect(result.error).toBeUndefined();
		expect(userRow(client, bob.id)?.bannedAt).toBeInstanceOf(Date);
		expect(sessionIdsOf(client, bob.id)).toEqual([]);
		expect(sessionIdsOf(client, admin.id)).toEqual([adminSession!.id]);
	});
});

describe("unbanUser action", () => {
	it("lifts the ban", async () => {
		const { client, db } = createTestDatabase("admin-unban");
		const admin = insertUser(client, "ada", "admin");
		const bob = insertUser(client, "bob");
		await db.mutations.users.ban(bob.id, admin.id);

		const result = await server.admin.unbanUser.call(actionContext(db, await signIn(db, admin.id)), form({ username: "bob" }));

		expect(result.error).toBeUndefined();
		expect(userRow(client, bob.id)?.bannedAt).toBeNull();
	});
});

describe("changeUserRole action", () => {
	it("makes a user an admin and takes the role away again", async () => {
		const { client, db } = createTestDatabase("admin-role");
		const admin = insertUser(client, "ada", "admin");
		const bob = insertUser(client, "bob");
		const context = actionContext(db, await signIn(db, admin.id));

		const promoted = await server.admin.changeUserRole.call(context, form({ username: "bob", role: "admin" }));

		expect(promoted.error).toBeUndefined();
		expect(userRow(client, bob.id)?.role).toBe("admin");

		const demoted = await server.admin.changeUserRole.call(context, form({ username: "bob", role: "user" }));

		expect(demoted.error).toBeUndefined();
		expect(userRow(client, bob.id)?.role).toBe("user");
	});

	it("does not let a user who is not an admin make themselves an admin", async () => {
		const { client, db } = createTestDatabase("admin-role-forbidden");
		const ada = insertUser(client, "ada");

		const result = await server.admin.changeUserRole.call(
			actionContext(db, await signIn(db, ada.id)),
			form({ username: "ada", role: "admin" }),
		);

		expect(result.error?.code).toBe("FORBIDDEN");
		expect(userRow(client, ada.id)?.role).toBe("user");
	});

	it("keeps one admin when two admins demote each other at the same time", async () => {
		const { client, db } = createTestDatabase("admin-role-race");
		const ada = insertUser(client, "ada", "admin");
		const bob = insertUser(client, "bob", "admin");
		const adaContext = actionContext(db, await signIn(db, ada.id));
		const bobContext = actionContext(db, await signIn(db, bob.id));

		const adaDemotesBob = await server.admin.changeUserRole.call(adaContext, form({ username: "bob", role: "user" }));
		const bobDemotesAda = await server.admin.changeUserRole.call(bobContext, form({ username: "ada", role: "user" }));

		expect(adaDemotesBob.error).toBeUndefined();
		expect(bobDemotesAda.error?.code).toBe("CONFLICT");
		expect(userRow(client, ada.id)?.role).toBe("admin");
		expect(userRow(client, bob.id)?.role).toBe("user");
	});
});
