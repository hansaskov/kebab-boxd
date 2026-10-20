import { experimental_AstroContainer as AstroContainer } from "astro/container";
import { describe, expect, it } from "vitest";
import SessionPage from "@src/pages/[username]/settings/sessions/[sessionId].astro";
import NotAuthorizedPage from "@src/pages/401.astro";
import NotFoundPage from "@src/pages/404.astro";
import { createSession, getSession, sessionHistoryPageSize } from "@src/auth/session";
import { createDrizzleDatabase, migrateDrizzleDatabase } from "@src/db";
import type { DB } from "@src/db";
import { history, users } from "@src/db/schema";

function createTestDb(name: string) {
	const db = createDrizzleDatabase(`file:${name}?mode=memory`);
	migrateDrizzleDatabase(db);
	return db;
}

function insertUser(db: DB, username: string) {
	return db
		.insert(users)
		.values({ fullname: `${username} user`, username, email: `${username}@example.com` })
		.returning()
		.get();
}

async function renderSessionPage(db: DB, viewerSessionId: string, username: string, sessionId: string, query = "") {
	const container = await AstroContainer.create();
	container.insertPageRoute("/401", NotAuthorizedPage);
	container.insertPageRoute("/404", NotFoundPage);
	const response = await container.renderToResponse(SessionPage, {
		locals: { db, session: await getSession(viewerSessionId, db) },
		params: { username, sessionId },
		request: new Request(`http://localhost/${username}/settings/sessions/${sessionId}${query}`),
	});
	return { response, html: await response.text() };
}

describe("SessionPage", () => {
	it("does not show a session that belongs to another user", async () => {
		const db = createTestDb("session-page-other-user");
		const user = insertUser(db, "firstuser");
		const stranger = insertUser(db, "seconduser");
		const current = await createSession(user.id, db);
		const strangerSession = await createSession(stranger.id, db);
		db.insert(history)
			.values({ sessionId: strangerSession.id, requestedAt: new Date(), method: "GET", route: "/secret", path: "/secret", status: 200 })
			.run();

		const { html } = await renderSessionPage(db, current.id, user.username, strangerSession.id);

		expect(html).not.toContain("/secret");
		expect(html).not.toContain("<h2>History</h2>");
		expect(html).toContain("404");
	});

	it("does not let a user open another user's sessions", async () => {
		const db = createTestDb("session-page-forbidden");
		const user = insertUser(db, "firstuser");
		const stranger = insertUser(db, "seconduser");
		const current = await createSession(user.id, db);
		const strangerSession = await createSession(stranger.id, db);

		const { html } = await renderSessionPage(db, current.id, stranger.username, strangerSession.id);

		expect(html).not.toContain("<h2>History</h2>");
		expect(html).toContain("401");
	});

	it("shows only the newest page of requests and links to the older ones", async () => {
		const db = createTestDb("session-page-limit");
		const user = insertUser(db, "firstuser");
		const current = await createSession(user.id, db);
		const now = Date.now();
		const total = sessionHistoryPageSize + 5;
		db.insert(history)
			.values(
				Array.from({ length: total }, (_, i) => ({
					sessionId: current.id,
					requestedAt: new Date(now - i * 1000),
					method: "GET",
					route: "/explore",
					path: `/request-${i}`,
					status: 200,
				})),
			)
			.run();

		const { html } = await renderSessionPage(db, current.id, user.username, current.id);

		expect(html.match(/\/request-\d+<\/span>/g)).toHaveLength(sessionHistoryPageSize);
		expect(html).toContain("/request-0</span>");
		expect(html).toContain(`/request-${sessionHistoryPageSize - 1}</span>`);
		expect(html).not.toContain(`/request-${sessionHistoryPageSize}</span>`);
		expect(html).toContain(`<dd class="t-body font-medium">${total}</dd>`);

		const olderHref = html.match(/href="([^"]*\?before=\d+)"[^>]*>Older requests/)?.[1];
		expect(olderHref).toBeDefined();
		const query = olderHref!.slice(olderHref!.indexOf("?"));

		const older = await renderSessionPage(db, current.id, user.username, current.id, query);

		expect(older.html).toContain(`/request-${sessionHistoryPageSize}</span>`);
		expect(older.html).toContain(`/request-${total - 1}</span>`);
		expect(older.html).not.toContain("/request-0</span>");
		expect(older.html).not.toContain("Older requests");
		expect(older.html).toContain("Newest requests");
	});
});
