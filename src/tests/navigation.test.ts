import { describe, expect, it } from "vitest";
import SettingsPage from "@src/pages/[username]/settings/index.astro";
import DataSettingsPage from "@src/pages/[username]/settings/data.astro";
import { renderPage } from "@src/tests/container";
import { createTestDatabase, insertUser, signIn } from "@src/tests/database";

describe("the settings", () => {
	it("are closed to a User who is not an Admin, for the settings of another", async () => {
		const { client, db } = createTestDatabase();
		const ada = insertUser(client, "ada");
		insertUser(client, "bob");

		const { response } = await renderPage(SettingsPage, { db, session: await signIn(db, ada.id) }, "/bob/settings", { username: "bob" });

		expect(response.status).toBe(403);
	});

	it("forbid the data of a User to an Admin", async () => {
		const { client, db } = createTestDatabase();
		const admin = insertUser(client, "root_admin", "admin");
		const ada = insertUser(client, "ada");

		const { response, html } = await renderPage(DataSettingsPage, { db, session: await signIn(db, admin.id) }, "/ada/settings/data", { username: "ada" });

		expect(response.status).toBe(403);
		expect(html).not.toContain(ada.email);
	});
});
