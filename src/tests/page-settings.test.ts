import { experimental_AstroContainer as AstroContainer } from "astro/container";
import { describe, expect, it } from "vitest";
import SettingsPage from "@src/pages/[username]/settings.astro";
import { createTestDatabase, insertUser, signIn } from "@src/tests/database";

describe("SettingsPage", () => {
	it("sends a username in other letter case to the address of the user", async () => {
		const { client, db } = createTestDatabase("settings-page-case");
		const ada = insertUser(client, "ada");
		const container = await AstroContainer.create();

		const response = await container.renderToResponse(SettingsPage, {
			locals: { db, session: await signIn(db, ada.id) },
			params: { username: "Ada" },
			request: new Request("http://localhost/Ada/settings?x=1"),
		});

		expect(response.status).toBe(301);
		expect(response.headers.get("Location")).toBe("/ada/settings?x=1");
	});
});
