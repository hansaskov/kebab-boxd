import { describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { server } from "@src/actions/index";
import { createSession, getSession } from "@src/auth/session";
import type { Database } from "@src/db";
import type { Client } from "@src/db/client";
import { sessions, users } from "@src/db/schema";
import { banAs, createTestDatabase, insertUser } from "@src/tests/database";

type AdminAction = keyof typeof server.admin;

type Session = Awaited<ReturnType<typeof getSession>>;

/** Calls the action with a session read earlier, as a request does that started before a change. */
async function callWithSession(db: Database, session: Session, action: AdminAction, fields: Record<string, string>) {
	const formData = new FormData();
	for (const [name, value] of Object.entries(fields)) {
		formData.set(name, value);
	}
	const actionContext = { locals: { db, session } };
	Reflect.set(actionContext, Symbol.for("astro.actionAPIContext"), true);

	return server.admin[action].call(actionContext, formData);
}

async function callAs(db: Database, sessionId: string, action: AdminAction, fields: Record<string, string>) {
	return callWithSession(db, await getSession(sessionId, db), action, fields);
}

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
		const adminSession = await createSession(admin.id, db);
		await createSession(bob.id, db);
		await createSession(bob.id, db);

		const result = await callAs(db, adminSession.id, "banUser", { username: "bob" });

		expect(result.error).toBeUndefined();
		expect(result.data).toEqual({ redirect: "/admin/users/bob" });
		expect(userRow(client, bob.id)?.bannedAt).toBeInstanceOf(Date);
		expect(sessionIdsOf(client, bob.id)).toEqual([]);
		expect(sessionIdsOf(client, admin.id)).toEqual([adminSession.id]);
	});

	it("keeps the time of the first ban when a user is banned again", async () => {
		const { client, db } = createTestDatabase("admin-ban-twice");
		const admin = insertUser(client, "ada", "admin");
		const bob = insertUser(client, "bob");
		const adminSession = await createSession(admin.id, db);
		const firstBan = new Date("2026-01-01T00:00:00Z");
		client.update(users).set({ bannedAt: firstBan }).where(eq(users.id, bob.id)).run();

		const result = await callAs(db, adminSession.id, "banUser", { username: "bob" });

		expect(result.error).toBeUndefined();
		expect(userRow(client, bob.id)?.bannedAt).toEqual(firstBan);
	});

	it("refuses when a user who is not an admin tries to ban someone", async () => {
		const { client, db } = createTestDatabase("admin-ban-forbidden");
		const ada = insertUser(client, "ada");
		const bob = insertUser(client, "bob");
		const adaSession = await createSession(ada.id, db);
		await createSession(bob.id, db);

		const result = await callAs(db, adaSession.id, "banUser", { username: "bob" });

		expect(result.error?.code).toBe("FORBIDDEN");
		expect(userRow(client, bob.id)?.bannedAt).toBeNull();
		expect(sessionIdsOf(client, bob.id)).toHaveLength(1);
	});

	it("refuses to ban an admin", async () => {
		const { client, db } = createTestDatabase("admin-ban-admin");
		const admin = insertUser(client, "ada", "admin");
		const otherAdmin = insertUser(client, "bob", "admin");
		const adminSession = await createSession(admin.id, db);

		const result = await callAs(db, adminSession.id, "banUser", { username: "bob" });

		expect(result.error?.code).toBe("FORBIDDEN");
		expect(userRow(client, otherAdmin.id)?.bannedAt).toBeNull();
	});

	it("refuses to ban a user who became an admin after the request started", async () => {
		const { client, db } = createTestDatabase("admin-ban-promoted");
		const admin = insertUser(client, "ada", "admin");
		const bob = insertUser(client, "bob");
		const adminSession = await getSession((await createSession(admin.id, db)).id, db);
		await createSession(bob.id, db);
		client.update(users).set({ role: "admin" }).where(eq(users.id, bob.id)).run();

		const result = await callWithSession(db, adminSession, "banUser", { username: "bob" });

		// The action reads Bob again, so the permission check refuses before the ban runs.
		expect(result.error?.code).toBe("FORBIDDEN");
		expect(await banAs(db, admin.id, bob.id)).toBe("refused");
		expect(userRow(client, bob.id)?.bannedAt).toBeNull();
		expect(sessionIdsOf(client, bob.id)).toHaveLength(1);
	});

	it("refuses to ban when the admin lost the role after the request started", async () => {
		const { client, db } = createTestDatabase("admin-ban-demoted");
		const admin = insertUser(client, "ada", "admin");
		const bob = insertUser(client, "bob");
		const adminSession = await getSession((await createSession(admin.id, db)).id, db);
		await createSession(bob.id, db);
		client.update(users).set({ role: "user" }).where(eq(users.id, admin.id)).run();

		const result = await callWithSession(db, adminSession, "banUser", { username: "bob" });

		// The session still says Ada is an Admin, so only the check in the transaction refuses.
		expect(result.error?.code).toBe("CONFLICT");
		expect(userRow(client, bob.id)?.bannedAt).toBeNull();
		expect(sessionIdsOf(client, bob.id)).toHaveLength(1);
	});

	it("reports a user that does not exist", async () => {
		const { client, db } = createTestDatabase("admin-ban-missing");
		const admin = insertUser(client, "ada", "admin");
		const adminSession = await createSession(admin.id, db);

		const result = await callAs(db, adminSession.id, "banUser", { username: "nobody" });

		expect(result.error?.code).toBe("NOT_FOUND");
	});
});

describe("unbanUser action", () => {
	it("lifts the ban so the user can sign in again", async () => {
		const { client, db } = createTestDatabase("admin-unban");
		const admin = insertUser(client, "ada", "admin");
		const bob = insertUser(client, "bob");
		const adminSession = await createSession(admin.id, db);
		await banAs(db, admin.id, bob.id);

		const result = await callAs(db, adminSession.id, "unbanUser", { username: "bob" });

		expect(result.error).toBeUndefined();
		expect(userRow(client, bob.id)?.bannedAt).toBeNull();
	});

	it("refuses to lift the ban when the admin lost the role after the request started", async () => {
		const { client, db } = createTestDatabase("admin-unban-demoted");
		const admin = insertUser(client, "ada", "admin");
		const bob = insertUser(client, "bob");
		const adminSession = await getSession((await createSession(admin.id, db)).id, db);
		await banAs(db, admin.id, bob.id);
		client.update(users).set({ role: "user" }).where(eq(users.id, admin.id)).run();

		const result = await callWithSession(db, adminSession, "unbanUser", { username: "bob" });

		expect(result.error?.code).toBe("CONFLICT");
		expect(userRow(client, bob.id)?.bannedAt).toBeInstanceOf(Date);
	});

	it("refuses when a user who is not an admin tries to lift a ban", async () => {
		const { client, db } = createTestDatabase("admin-unban-forbidden");
		const admin = insertUser(client, "admin", "admin");
		const ada = insertUser(client, "ada");
		const bob = insertUser(client, "bob");
		const adaSession = await createSession(ada.id, db);
		await banAs(db, admin.id, bob.id);

		const result = await callAs(db, adaSession.id, "unbanUser", { username: "bob" });

		expect(result.error?.code).toBe("FORBIDDEN");
		expect(userRow(client, bob.id)?.bannedAt).toBeInstanceOf(Date);
	});
});

describe("changeUserRole action", () => {
	it("makes a user an admin and takes the role away again", async () => {
		const { client, db } = createTestDatabase("admin-role");
		const admin = insertUser(client, "ada", "admin");
		const bob = insertUser(client, "bob");
		const adminSession = await createSession(admin.id, db);

		const promoted = await callAs(db, adminSession.id, "changeUserRole", { username: "bob", role: "admin" });

		expect(promoted.error).toBeUndefined();
		expect(userRow(client, bob.id)?.role).toBe("admin");

		const demoted = await callAs(db, adminSession.id, "changeUserRole", { username: "bob", role: "user" });

		expect(demoted.error).toBeUndefined();
		expect(userRow(client, bob.id)?.role).toBe("user");
	});

	it("refuses when an admin tries to change their own role", async () => {
		const { client, db } = createTestDatabase("admin-role-self");
		const admin = insertUser(client, "ada", "admin");
		const adminSession = await createSession(admin.id, db);

		const result = await callAs(db, adminSession.id, "changeUserRole", { username: "ada", role: "user" });

		expect(result.error?.code).toBe("FORBIDDEN");
		expect(userRow(client, admin.id)?.role).toBe("admin");
	});

	it("refuses when a user who is not an admin tries to make themselves an admin", async () => {
		const { client, db } = createTestDatabase("admin-role-forbidden");
		const ada = insertUser(client, "ada");
		const adaSession = await createSession(ada.id, db);

		const result = await callAs(db, adaSession.id, "changeUserRole", { username: "ada", role: "admin" });

		expect(result.error?.code).toBe("FORBIDDEN");
		expect(userRow(client, ada.id)?.role).toBe("user");
	});

	it("refuses to change the role of a banned user, so the ban can still be lifted", async () => {
		const { client, db } = createTestDatabase("admin-role-banned");
		const admin = insertUser(client, "ada", "admin");
		const bob = insertUser(client, "bob");
		const adminSession = await createSession(admin.id, db);
		await banAs(db, admin.id, bob.id);

		const promoted = await callAs(db, adminSession.id, "changeUserRole", { username: "bob", role: "admin" });

		expect(promoted.error?.code).toBe("FORBIDDEN");
		expect(userRow(client, bob.id)?.role).toBe("user");

		const unbanned = await callAs(db, adminSession.id, "unbanUser", { username: "bob" });

		expect(unbanned.error).toBeUndefined();
		expect(userRow(client, bob.id)?.bannedAt).toBeNull();
	});

	it("keeps one admin when two admins demote each other at the same time", async () => {
		const { client, db } = createTestDatabase("admin-role-race");
		const ada = insertUser(client, "ada", "admin");
		const bob = insertUser(client, "bob", "admin");
		// Both requests read their session before either change is saved.
		const adaSession = await getSession((await createSession(ada.id, db)).id, db);
		const bobSession = await getSession((await createSession(bob.id, db)).id, db);

		const adaDemotesBob = await callWithSession(db, adaSession, "changeUserRole", { username: "bob", role: "user" });
		const bobDemotesAda = await callWithSession(db, bobSession, "changeUserRole", { username: "ada", role: "user" });

		expect(adaDemotesBob.error).toBeUndefined();
		expect(bobDemotesAda.error?.code).toBe("CONFLICT");
		expect(userRow(client, ada.id)?.role).toBe("admin");
		expect(userRow(client, bob.id)?.role).toBe("user");
	});

	it("rejects a role that does not exist", async () => {
		const { client, db } = createTestDatabase("admin-role-invalid");
		const admin = insertUser(client, "ada", "admin");
		const bob = insertUser(client, "bob");
		const adminSession = await createSession(admin.id, db);

		const result = await callAs(db, adminSession.id, "changeUserRole", { username: "bob", role: "owner" });

		expect(result.error?.code).toBe("BAD_REQUEST");
		expect(userRow(client, bob.id)?.role).toBe("user");
	});
});
