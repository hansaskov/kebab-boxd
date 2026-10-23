import { experimental_AstroContainer as AstroContainer } from "astro/container";
import { describe, expect, it } from "vitest";
import SessionPage from "@src/pages/[username]/settings/sessions/[sessionId].astro";
import ForbiddenPage from "@src/pages/403.astro";
import NotFoundPage from "@src/pages/404.astro";
import { createSession, type SessionWithUser } from "@src/auth/session";
import type { Database } from "@src/db";
import { history } from "@src/db/schema";
import { createTestDatabase, insertUser, signIn } from "@src/tests/database";

async function renderSessionPage(db: Database, viewer: SessionWithUser, username: string, sessionId: string) {
	const container = await AstroContainer.create();
	container.insertPageRoute("/403", ForbiddenPage);
	container.insertPageRoute("/404", NotFoundPage);
	const response = await container.renderToResponse(SessionPage, {
		locals: { db, session: viewer },
		params: { username, sessionId },
		request: new Request(`http://localhost/${username}/settings/sessions/${sessionId}`),
	});
	return { response, html: await response.text() };
}

describe("SessionPage", () => {
	it("does not show the session of another user under your own username", async () => {
		const { client, db } = createTestDatabase("session-page-other-user");
		const ada = insertUser(client, "ada");
		const bob = insertUser(client, "bob");
		const bobSession = await createSession(bob.id, db);
		client.insert(history)
			.values({ sessionId: bobSession.id, requestedAt: new Date(), method: "GET", route: "/secret", path: "/secret", status: 200 })
			.run();

		const { response, html } = await renderSessionPage(db, await signIn(db, ada.id), "ada", bobSession.id);

		expect(response.status).toBe(404);
		expect(html).not.toContain("/secret");
	});

	it("does not let a user open the sessions of another user", async () => {
		const { client, db } = createTestDatabase("session-page-forbidden");
		const ada = insertUser(client, "ada");
		const bob = insertUser(client, "bob");
		const bobSession = await createSession(bob.id, db);

		const { response } = await renderSessionPage(db, await signIn(db, ada.id), "bob", bobSession.id);

		expect(response.status).toBe(403);
	});
});
