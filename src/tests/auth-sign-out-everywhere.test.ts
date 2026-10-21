import { describe, expect, it } from "vitest";
import { server } from "@src/actions/index";
import { createSession, getSession } from "@src/auth/session";
import type { Database } from "@src/db";
import { sessions } from "@src/db/schema";
import { createTestDatabase, insertUser } from "@src/tests/database";

async function signOutEverywhereAs(db: Database, sessionId: string, currentUsername: string) {
	const formData = new FormData();
	formData.set("currentUsername", currentUsername);
	const actionContext = { locals: { db, session: await getSession(sessionId, db) } };
	Reflect.set(actionContext, Symbol.for("astro.actionAPIContext"), true);

	return server.signOutEverywhere.call(actionContext, formData);
}

describe("signOutEverywhere action", () => {
	it("refuses when a user tries to sign out someone else", async () => {
		const { client, db } = createTestDatabase("sign-out-everywhere-forbidden");
		const ada = insertUser(client, "ada");
		const bob = insertUser(client, "bob");
		const adaSession = await createSession(ada.id, db);
		await createSession(bob.id, db);

		const result = await signOutEverywhereAs(db, adaSession.id, bob.username);

		expect(result.error?.code).toBe("FORBIDDEN");
		expect(await client.$count(sessions)).toBe(2);
	});
});
