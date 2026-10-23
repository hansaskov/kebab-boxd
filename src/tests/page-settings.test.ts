import { experimental_AstroContainer as AstroContainer } from "astro/container";
import { describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import SettingsPage from "@src/pages/[username]/settings.astro";
import { createSession, type SessionWithUser } from "@src/auth/session";
import type { Database } from "@src/db";
import { history, sessions } from "@src/db/schema";
import { createTestDatabase, insertUser, signIn } from "@src/tests/database";

async function renderSettings(db: Database, session: SessionWithUser, username: string) {
	const container = await AstroContainer.create();
	const response = await container.renderToResponse(SettingsPage, {
		locals: { db, session },
		params: { username },
		request: new Request(`http://localhost/${username}/settings`),
	});
	return { response, html: await response.text() };
}

function listedDevices(html: string) {
	return [...html.matchAll(/href="\/ada\/settings\/sessions\/([^"]+)"/g)].map((match) => match[1]);
}

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

		const { response, html } = await renderSettings(db, session, "ada");

		expect(response.status).toBe(200);
		expect(html).toContain("This device");
		expect(html).toContain(`datetime="${requestedAt.toISOString()}"`);
	});

	it("lists only the devices that have not timed out, the most recently used first", async () => {
		const { client, db } = createTestDatabase("settings-page-device-order");
		const ada = insertUser(client, "ada");
		const session = await signIn(db, ada.id);
		const [older, newer, unused, timedOut] = [
			await createSession(ada.id, db),
			await createSession(ada.id, db),
			await createSession(ada.id, db),
			await createSession(ada.id, db),
		];
		const request = { method: "GET", route: "/", path: "/", status: 200 };
		client
			.insert(history)
			.values([
				{ ...request, sessionId: older!.id, requestedAt: new Date("2026-10-01T12:00:00Z") },
				{ ...request, sessionId: newer!.id, requestedAt: new Date("2026-10-01T12:01:00Z") },
				{ ...request, sessionId: timedOut!.id, requestedAt: new Date("2026-10-01T12:02:00Z") },
			])
			.run();
		client
			.update(sessions)
			.set({ lastVerifiedAt: new Date(Date.now() - 31 * 24 * 60 * 60 * 1000) })
			.where(eq(sessions.id, timedOut!.id))
			.run();

		const devices = listedDevices((await renderSettings(db, session, "ada")).html);

		expect(devices.slice(0, 2)).toEqual([newer!.id, older!.id]);
		expect(devices.toSorted()).toEqual([newer!.id, older!.id, unused!.id, session.id].toSorted());
	});
});
