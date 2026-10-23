import { experimental_AstroContainer as AstroContainer } from "astro/container";
import { describe, expect, it } from "vitest";
import SettingsPage from "@src/pages/[username]/settings.astro";
import { history } from "@src/db/schema";
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

	it("lists the signed-in devices with the time they were last used", async () => {
		const { client, db } = createTestDatabase("settings-page-devices");
		const ada = insertUser(client, "ada");
		const session = await signIn(db, ada.id);
		const requestedAt = new Date("2026-10-01T12:00:00Z");
		client.insert(history).values({ sessionId: session.id, requestedAt, method: "GET", route: "/", path: "/", status: 200 }).run();
		const container = await AstroContainer.create();

		const response = await container.renderToResponse(SettingsPage, {
			locals: { db, session },
			params: { username: "ada" },
			request: new Request("http://localhost/ada/settings"),
		});
		const html = await response.text();

		expect(response.status).toBe(200);
		expect(html).toContain("This device");
		expect(html).toContain(`datetime="${requestedAt.toISOString()}"`);
	});
});
