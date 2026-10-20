import { experimental_AstroContainer as AstroContainer } from "astro/container";
import { describe, expect, it } from "vitest";
import SessionPage from "@src/pages/[username]/settings/sessions/[sessionId].astro";
import NotAuthorizedPage from "@src/pages/401.astro";
import NotFoundPage from "@src/pages/404.astro";
import { createSession, getSession, sessionHistoryPageSize } from "@src/auth/session";
import { createDrizzleDatabase, migrateDrizzleDatabase } from "@src/db";
import type { DB } from "@src/db";
import { eq } from "drizzle-orm";
import { history, sessions, users } from "@src/db/schema";

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

// The query of a pagination link, or undefined when the link is turned off.
function linkQuery(html: string, rel: "prev" | "next") {
	const href = html.match(new RegExp(`rel="${rel}" href="([^"]*)"`))?.[1]?.replaceAll("&amp;", "&");
	return href === undefined ? undefined : href.slice(href.indexOf("?") === -1 ? href.length : href.indexOf("?"));
}

function insertRequests(db: DB, sessionId: string, total: number) {
	const now = Date.now();
	db.insert(history)
		.values(
			Array.from({ length: total }, (_, i) => ({
				sessionId,
				requestedAt: new Date(now - i * 1000),
				method: "GET",
				route: "/explore",
				path: `/request-${i}`,
				status: 200,
			})),
		)
		.run();
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
		const total = sessionHistoryPageSize + 5;
		insertRequests(db, current.id, total);

		const { html } = await renderSessionPage(db, current.id, user.username, current.id);

		expect(html.match(/\/request-\d+<\/span>/g)).toHaveLength(sessionHistoryPageSize);
		expect(html).toContain("/request-0</span>");
		expect(html).toContain(`/request-${sessionHistoryPageSize - 1}</span>`);
		expect(html).not.toContain(`/request-${sessionHistoryPageSize}</span>`);
		expect(html).toContain(`<dd class="t-body font-medium">${total}</dd>`);

		expect(linkQuery(html, "prev")).toBeUndefined();
		const query = linkQuery(html, "next");
		expect(query).toMatch(/^\?before=\d+$/);

		const older = await renderSessionPage(db, current.id, user.username, current.id, query);

		expect(older.html).toContain(`/request-${sessionHistoryPageSize}</span>`);
		expect(older.html).toContain(`/request-${total - 1}</span>`);
		expect(older.html).not.toContain("/request-0</span>");
		expect(linkQuery(older.html, "next")).toBeUndefined();

		const newerQuery = linkQuery(older.html, "prev");
		expect(newerQuery).toMatch(/^\?after=\d+$/);

		const newer = await renderSessionPage(db, current.id, user.username, current.id, newerQuery);

		expect(newer.html.match(/\/request-\d+<\/span>/g)).toHaveLength(sessionHistoryPageSize);
		expect(newer.html).toContain("/request-0</span>");
		expect(newer.html).toContain(`/request-${sessionHistoryPageSize - 1}</span>`);
		expect(newer.html.indexOf("/request-0</span>")).toBeLessThan(newer.html.indexOf("/request-1</span>"));
		expect(linkQuery(newer.html, "prev")).toBeUndefined();
		expect(linkQuery(newer.html, "next")).toMatch(/^\?before=\d+$/);
	});

	it("shows the chosen number of rows per page and keeps it when paging", async () => {
		const db = createTestDb("session-page-rows");
		const user = insertUser(db, "firstuser");
		const current = await createSession(user.id, db);
		insertRequests(db, current.id, 30);

		const { html } = await renderSessionPage(db, current.id, user.username, current.id, "?rows=10");

		expect(html.match(/\/request-\d+<\/span>/g)).toHaveLength(10);
		const query = linkQuery(html, "next");
		expect(query).toMatch(/^\?before=\d+&rows=10$/);

		const older = await renderSessionPage(db, current.id, user.username, current.id, query);

		expect(older.html.match(/\/request-\d+<\/span>/g)).toHaveLength(10);
		expect(older.html).toContain("/request-10</span>");
		expect(older.html).toContain("/request-19</span>");
		// The rows-per-page links keep the page starting where it does.
		expect(older.html).toContain(`${query!.replace("&rows=10", "&amp;rows=50")}"`);
	});

	it("falls back to the default number of rows for sizes not on offer", async () => {
		const db = createTestDb("session-page-rows-invalid");
		const user = insertUser(db, "firstuser");
		const current = await createSession(user.id, db);
		insertRequests(db, current.id, sessionHistoryPageSize + 1);

		const { html } = await renderSessionPage(db, current.id, user.username, current.id, "?rows=100000");

		expect(html.match(/\/request-\d+<\/span>/g)).toHaveLength(sessionHistoryPageSize);
	});

	it("links back to the newest requests from a page past the oldest one", async () => {
		const db = createTestDb("session-page-past-end");
		const user = insertUser(db, "firstuser");
		const current = await createSession(user.id, db);
		db.insert(history)
			.values({ sessionId: current.id, requestedAt: new Date(), method: "GET", route: "/explore", path: "/explore", status: 200 })
			.run();

		const { html } = await renderSessionPage(db, current.id, user.username, current.id, "?before=1");

		expect(html).toContain("There are no older requests.");
		expect(linkQuery(html, "prev")).toBe("");
		expect(linkQuery(html, "next")).toBeUndefined();
	});

	it("numbers another device in the order it signed in", async () => {
		const db = createTestDb("session-page-device-name");
		const user = insertUser(db, "firstuser");
		const stranger = insertUser(db, "seconduser");
		const strangerSession = await createSession(stranger.id, db);
		const later = await createSession(user.id, db);
		const earlier = await createSession(user.id, db);
		const current = await createSession(user.id, db);
		const signIn = (id: string, ms: number) =>
			db.update(sessions).set({ createdAt: new Date(ms) }).where(eq(sessions.id, id)).run();
		signIn(strangerSession.id, 1000);
		signIn(earlier.id, 2000);
		signIn(later.id, 3000);
		signIn(current.id, 4000);

		const { html } = await renderSessionPage(db, current.id, user.username, later.id);

		expect(html).toContain("<h1>Device 2</h1>");
	});
});
