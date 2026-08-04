import { experimental_AstroContainer as AstroContainer } from "astro/container";
import { isInputError } from "astro:actions";
import { describe, expect, it } from "vitest";
import SettingsPage from "@src/pages/[username]/settings.astro";
import { server } from "@src/actions/index";
import { createSession, getSession } from "@src/auth/session";
import { createDrizzleDatabase, migrateDrizzleDatabase } from "@src/db";
import { users } from "@src/db/schema";

describe("SettingsPage", () => {
	it("renders a form connected to the settings action", async () => {
		const db = createDrizzleDatabase("file:settings-form?mode=memory");
		migrateDrizzleDatabase(db);
		const user = db
			.insert(users)
			.values({
				fullname: "First User",
				username: "firstuser",
				email: "first@example.com",
				googleId: "google-1",
			})
			.returning()
			.get();
		const session = await createSession(user.id, db);
		const sessionWithUser = await getSession(session.id, db)
		const container = await AstroContainer.create();

		const response = await container.renderToResponse(SettingsPage, {
			locals: { db, session: sessionWithUser },
			params: { username: user.username },
		});
		const html = await response.text();

		expect(html).toContain('action="?_action=updateSettings"');
		expect(html).toContain('name="fullname"');
		expect(html).toContain('name="username"');
		expect(html).toContain('name="pronoun"');
		expect(html).toContain('name="bio"');
		expect(html).toContain('<fieldset class="space-y-6">');
		expect(html).not.toContain("fieldset-label");
		expect(html).not.toContain("fieldset-legend");
	});

	it("returns validation errors for each invalid settings field", async () => {
		const actionContext = { locals: {} };
		Reflect.set(actionContext, Symbol.for("astro.actionAPIContext"), true);
		const formData = new FormData();
		formData.set("currentUsername", "firstuser");
		formData.set("fullname", "A");
		formData.set("username", "A");
		formData.set("pronoun", "Not a pronoun");
		formData.set("bio", "A".repeat(501));

		const result = await server.updateSettings.call(actionContext, formData);

		expect(isInputError(result.error)).toBe(true);
		if (isInputError(result.error)) {
			expect(result.error.fields.fullname).toBeDefined();
			expect(result.error.fields.username).toBeDefined();
			expect(result.error.fields.pronoun).toBeDefined();
			expect(result.error.fields.bio).toBeDefined();
		}
	});

	it("returns a field error when the username is already taken", async () => {
		const db = createDrizzleDatabase("file:settings-duplicate-username?mode=memory");
		migrateDrizzleDatabase(db);
		const user = db
			.insert(users)
			.values({
				fullname: "First User",
				username: "firstuser",
				email: "first@example.com",
				googleId: "google-1",
			})
			.returning()
			.get();
		db.insert(users)
			.values({
				fullname: "Second User",
				username: "seconduser",
				email: "second@example.com",
				googleId: "google-2",
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

	it("renders a username conflict below the username field", async () => {
		const db = createDrizzleDatabase("file:settings-username-error?mode=memory");
		migrateDrizzleDatabase(db);
		const user = db
			.insert(users)
			.values({
				fullname: "First User",
				username: "firstuser",
				email: "first@example.com",
				googleId: "google-1",
			})
			.returning()
			.get();
		const session = await createSession(user.id, db);
		const container = await AstroContainer.create();

		const response = await container.renderToResponse(SettingsPage, {
			locals: {
				db,
				session: { ...session, user },
				_actionPayload: {
					actionName: "updateSettings",
					actionResult: {
						type: "error",
						status: 409,
						contentType: "application/json",
						body: JSON.stringify({
							type: "AstroActionError",
							code: "CONFLICT",
							status: 409,
							message: "Username is already taken.",
						}),
					},
				},
			} as App.Locals,
			params: { username: user.username },
		});
		const html = await response.text();

		expect(html).toContain('Username is already taken.');
	});
});
