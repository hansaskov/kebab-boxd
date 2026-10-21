import { experimental_AstroContainer as AstroContainer } from "astro/container";
import { describe, expect, it } from "vitest";
import SettingsPage from "@src/pages/[username]/settings.astro";
import ForbiddenPage from "@src/pages/403.astro";
import NotFoundPage from "@src/pages/404.astro";
import { server } from "@src/actions/index";
import { createSession, getSession } from "@src/auth/session";
import type { Database } from "@src/db";
import { users } from "@src/db/schema";
import type { User } from "@src/db/schema";
import { createTestDatabase, insertUser } from "@src/tests/database";

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

async function updateSettingsAs(db: Database, sessionId: string, target: User, username: string) {
	const formData = new FormData();
	formData.set("currentUsername", target.username);
	formData.set("fullname", target.fullname);
	formData.set("username", username);
	formData.set("pronoun", "");
	formData.set("bio", "");
	const actionContext = { locals: { db, session: await getSession(sessionId, db) } };
	Reflect.set(actionContext, Symbol.for("astro.actionAPIContext"), true);

	return server.updateSettings.call(actionContext, formData);
}

async function renderSettingsPage(db: Database, viewerSessionId: string, username: string) {
	const container = await AstroContainer.create();
	container.insertPageRoute("/403", ForbiddenPage);
	container.insertPageRoute("/404", NotFoundPage);
	const response = await container.renderToResponse(SettingsPage, {
		locals: { db, session: await getSession(viewerSessionId, db) },
		params: { username },
		request: new Request(`http://localhost/${username}/settings`),
	});
	return { response, html: await response.text() };
}

describe("updateSettings action", () => {
	it("refuses when a user tries to change someone else's profile", async () => {
		const { client, db } = createTestDatabase("settings-forbidden");
		const ada = insertUser(client, "ada");
		const bob = insertUser(client, "bob");
		const adaSession = await createSession(ada.id, db);

		const result = await updateSettingsAs(db, adaSession.id, bob, "hacked");

		expect(result.error?.code).toBe("FORBIDDEN");
		expect((await db.queries.users.findByUsername("bob"))?.id).toBe(bob.id);
		expect(await db.queries.users.findByUsername("hacked")).toBeUndefined();
	});

	it("lets an admin change someone else's profile", async () => {
		const { client, db } = createTestDatabase("settings-admin");
		const admin = insertUser(client, "ada", "admin");
		const bob = insertUser(client, "bob");
		const adminSession = await createSession(admin.id, db);

		const result = await updateSettingsAs(db, adminSession.id, bob, "robert");

		expect(result.error).toBeUndefined();
		expect((await db.queries.users.findByUsername("robert"))?.id).toBe(bob.id);
	});
});

describe("SettingsPage access", () => {
	it("lets a user open their own settings and devices", async () => {
		const { client, db } = createTestDatabase("settings-page-own");
		const ada = insertUser(client, "ada");
		const adaSession = await createSession(ada.id, db);

		const { response, html } = await renderSettingsPage(db, adaSession.id, "ada");

		expect(response.status).toBe(200);
		expect(html).toContain("Save settings");
		expect(html).toContain(`/ada/settings/sessions/${adaSession.id}`);
		expect(html).toContain("Sign out on all devices, including this one.");
	});

	it("does not let a user open someone else's settings", async () => {
		const { client, db } = createTestDatabase("settings-page-forbidden");
		const ada = insertUser(client, "ada");
		insertUser(client, "bob");
		const adaSession = await createSession(ada.id, db);

		const { response, html } = await renderSettingsPage(db, adaSession.id, "bob");

		expect(response.status).toBe(403);
		expect(html).not.toContain("Save settings");
	});

	it("lets an admin open someone else's settings and devices", async () => {
		const { client, db } = createTestDatabase("settings-page-admin");
		const admin = insertUser(client, "ada", "admin");
		const bob = insertUser(client, "bob");
		const adminSession = await createSession(admin.id, db);
		const bobSession = await createSession(bob.id, db);

		const { response, html } = await renderSettingsPage(db, adminSession.id, "bob");

		expect(response.status).toBe(200);
		expect(html).toContain("Save settings");
		expect(html).toContain(`/bob/settings/sessions/${bobSession.id}`);
		expect(html).toContain("Sign bob user out on all devices.");
	});
});
