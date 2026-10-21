import { describe, expect, it } from "vitest";
import { server } from "@src/actions/index";
import { createSession } from "@src/auth/session";
import { users } from "@src/db/schema";
import { createTestDatabase } from "@src/tests/database";

describe("SettingsPage", () => {
	it("returns a field error when the username is already taken", async () => {
		const { client, db } = createTestDatabase("settings-duplicate-username");
		const user = client
			.insert(users)
			.values({
				fullname: "First User",
				username: "firstuser",
				email: "first@example.com",
			})
			.returning()
			.get();
		client.insert(users)
			.values({
				fullname: "Second User",
				username: "seconduser",
				email: "second@example.com",
			})
			.run();
		const session = await createSession(user.id, db);
		const formData = new FormData();
		formData.set("currentUsername", user.username);
		formData.set("fullname", user.fullname);
		formData.set("username", "seconduser");
		formData.set("pronoun", "");
		formData.set("bio", "");
		const actionContext = {
			locals: { db, session: { ...session, user } },
		};
		Reflect.set(actionContext, Symbol.for("astro.actionAPIContext"), true);

		const result = await server.updateSettings.call(
			actionContext,
			formData,
		);

		expect(result.error).toBeDefined();
		expect(result.error?.code).toBe("CONFLICT");
		expect(result.error?.message).toBe("Username is already taken.");
	});
});
