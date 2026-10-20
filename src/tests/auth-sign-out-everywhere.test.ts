import { describe, expect, it } from "vitest";
import { server } from "@src/actions/index";
import { createSession, getSession } from "@src/auth/session";
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

describe("signOutEverywhere action", () => {
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
});
