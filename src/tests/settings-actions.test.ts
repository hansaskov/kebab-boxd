import { describe, expect, it } from "vitest";
import { server } from "@src/actions/index";
import { createSession } from "@src/auth/session";
import { sessions } from "@src/db/schema";
import { actionContext, form } from "@src/tests/actions";
import { createTestDatabase, insertUser, signIn } from "@src/tests/database";

function profileForm(currentUsername: string, username: string) {
	return form({ currentUsername, username, fullname: "Some One", pronoun: "", bio: "" });
}

describe("updateSettings action", () => {
	it("reports a username that another user has, ignoring letter case", async () => {
		const { client, db } = createTestDatabase("settings-username-taken");
		const ada = insertUser(client, "ada");
		insertUser(client, "bob");

		const result = await server.updateSettings.call(actionContext(db, await signIn(db, ada.id)), profileForm("ada", "BOB"));

		expect(result.error?.code).toBe("CONFLICT");
		expect((await db.queries.users.findByUsername("ada"))?.id).toBe(ada.id);
	});

	it("saves a bio of only spaces as no bio", async () => {
		const { client, db } = createTestDatabase("settings-blank-bio");
		const ada = insertUser(client, "ada");
		const fields = { currentUsername: "ada", username: "ada", fullname: "Ada user", pronoun: "", bio: "   " };

		const result = await server.updateSettings.call(actionContext(db, await signIn(db, ada.id)), form(fields));

		expect(result.error).toBeUndefined();
		expect((await db.queries.users.findByUsername("ada"))?.bio).toBeNull();
	});

	it("does not let a user change someone else's profile", async () => {
		const { client, db } = createTestDatabase("settings-forbidden");
		const ada = insertUser(client, "ada");
		const bob = insertUser(client, "bob");

		const result = await server.updateSettings.call(actionContext(db, await signIn(db, ada.id)), profileForm("bob", "hacked"));

		expect(result.error?.code).toBe("FORBIDDEN");
		expect((await db.queries.users.findByUsername("bob"))?.id).toBe(bob.id);
	});
});

describe("signOutEverywhere action", () => {
	it("does not let a user sign out someone else", async () => {
		const { client, db } = createTestDatabase("sign-out-everywhere-forbidden");
		const ada = insertUser(client, "ada");
		const bob = insertUser(client, "bob");
		const adaSession = await signIn(db, ada.id);
		await createSession(bob.id, db);

		const result = await server.signOutEverywhere.call(actionContext(db, adaSession), form({ currentUsername: "bob" }));

		expect(result.error?.code).toBe("FORBIDDEN");
		expect(await client.$count(sessions)).toBe(2);
	});
});
