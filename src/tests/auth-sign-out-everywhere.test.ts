import { experimental_AstroContainer as AstroContainer } from "astro/container";
import { describe, expect, it } from "vitest";
import { server } from "@src/actions/index";
import SettingsPage from "@src/pages/[username]/settings.astro";
import { createSession, deleteUserSessions, getSession } from "@src/auth/session";
import { createDrizzleDatabase, migrateDrizzleDatabase } from "@src/db";
import type { DB } from "@src/db";
import { sessions, users } from "@src/db/schema";

function createTestDb(name: string) {
	const db = createDrizzleDatabase(`file:${name}?mode=memory`);
	migrateDrizzleDatabase(db);
	return db;
}

function insertUser(db: DB, username: string, role: "user" | "admin" = "user") {
	return db
		.insert(users)
		.values({ fullname: `${username} user`, username, email: `${username}@example.com`, role })
		.returning()
		.get();
}

async function signOutEverywhereAs(db: DB, sessionId: string, currentUsername: string) {
	const formData = new FormData();
	formData.set("currentUsername", currentUsername);
	const actionContext = { locals: { db, session: await getSession(sessionId, db) } };
	Reflect.set(actionContext, Symbol.for("astro.actionAPIContext"), true);

	return server.signOutEverywhere.call(actionContext, formData);
}

describe("deleteUserSessions", () => {
	it("deletes every session of the user and keeps other users' sessions", async () => {
		const db = createTestDb("sign-out-everywhere-delete");
		const ada = insertUser(db, "ada");
		const bob = insertUser(db, "bob");
		await createSession(ada.id, db);
		await createSession(ada.id, db);
		const bobSession = await createSession(bob.id, db);

		await deleteUserSessions(ada.id, db);

		const remaining = await db.select({ id: sessions.id }).from(sessions);
		expect(remaining).toEqual([{ id: bobSession.id }]);
	});
});

describe("signOutEverywhere action", () => {
	it("lets an admin sign out another user and keeps the admin signed in", async () => {
		const db = createTestDb("sign-out-everywhere-admin");
		const admin = insertUser(db, "boss", "admin");
		const ada = insertUser(db, "ada");
		const adminSession = await createSession(admin.id, db);
		await createSession(ada.id, db);
		await createSession(ada.id, db);

		const result = await signOutEverywhereAs(db, adminSession.id, ada.username);

		expect(result.error).toBeUndefined();
		expect(result.data).toEqual({ redirect: "/ada/settings" });
		expect(await db.$count(sessions)).toBe(1);
		expect(await getSession(adminSession.id, db)).not.toBeNull();
	});

	it("refuses when a user tries to sign out someone else", async () => {
		const db = createTestDb("sign-out-everywhere-forbidden");
		const ada = insertUser(db, "ada");
		const bob = insertUser(db, "bob");
		const adaSession = await createSession(ada.id, db);
		await createSession(bob.id, db);

		const result = await signOutEverywhereAs(db, adaSession.id, bob.username);

		expect(result.error?.code).toBe("FORBIDDEN");
		expect(await db.$count(sessions)).toBe(2);
	});

	it("refuses when nobody is signed in", async () => {
		const db = createTestDb("sign-out-everywhere-anonymous");
		const ada = insertUser(db, "ada");
		await createSession(ada.id, db);

		const result = await signOutEverywhereAs(db, "no-such-session", ada.username);

		expect(result.error?.code).toBe("UNAUTHORIZED");
		expect(await db.$count(sessions)).toBe(1);
	});
});

describe("SettingsPage sessions section", () => {
	it("renders a sign-out-everywhere form for the user", async () => {
		const db = createTestDb("sign-out-everywhere-page");
		const ada = insertUser(db, "ada");
		const session = await createSession(ada.id, db);
		const container = await AstroContainer.create();

		const response = await container.renderToResponse(SettingsPage, {
			locals: { db, session: await getSession(session.id, db) },
			params: { username: ada.username },
		});
		const html = await response.text();

		expect(html).toContain('id="sessions"');
		expect(html).toContain('action="?_action=signOutEverywhere"');
		expect(html).toContain("Sign out everywhere");
	});
});
