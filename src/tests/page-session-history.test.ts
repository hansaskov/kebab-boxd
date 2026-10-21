import { experimental_AstroContainer as AstroContainer } from "astro/container";
import { describe, expect, it } from "vitest";
import SessionPage from "@src/pages/[username]/settings/sessions/[sessionId].astro";
import ForbiddenPage from "@src/pages/403.astro";
import NotFoundPage from "@src/pages/404.astro";
import { createSession, getSession } from "@src/auth/session";
import { defaultPageSize } from "@src/validation/page-size";
import type { Database } from "@src/db";
import type { Client } from "@src/db/client";
import { eq } from "drizzle-orm";
import { history, sessions } from "@src/db/schema";
import { createTestDatabase, insertUser } from "@src/tests/database";

// The query of a pagination link, or undefined when the link is turned off.
function linkQuery(html: string, rel: "prev" | "next") {
	const href = html.match(new RegExp(`rel="${rel}" href="([^"]*)"`))?.[1]?.replaceAll("&amp;", "&");
	return href === undefined ? undefined : href.slice(href.indexOf("?") === -1 ? href.length : href.indexOf("?"));
}

function insertRequests(client: Client, sessionId: string, total: number) {
	const now = Date.now();
	client.insert(history)
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

async function renderSessionPage(db: Database, viewerSessionId: string, username: string, sessionId: string, query = "") {
	const container = await AstroContainer.create();
	container.insertPageRoute("/403", ForbiddenPage);
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
		const { client, db } = createTestDatabase("session-page-other-user");
		const user = insertUser(client, "firstuser");
		const stranger = insertUser(client, "seconduser");
		const current = await createSession(user.id, db);
		const strangerSession = await createSession(stranger.id, db);
		client.insert(history)
			.values({ sessionId: strangerSession.id, requestedAt: new Date(), method: "GET", route: "/secret", path: "/secret", status: 200 })
			.run();

		const { html } = await renderSessionPage(db, current.id, user.username, strangerSession.id);

		expect(html).not.toContain("/secret");
		expect(html).not.toContain("<h2>History</h2>");
		expect(html).toContain("404");
	});

	it("does not let a user open another user's sessions", async () => {
		const { client, db } = createTestDatabase("session-page-forbidden");
		const user = insertUser(client, "firstuser");
		const stranger = insertUser(client, "seconduser");
		const current = await createSession(user.id, db);
		const strangerSession = await createSession(stranger.id, db);

		const { response, html } = await renderSessionPage(db, current.id, stranger.username, strangerSession.id);

		expect(response.status).toBe(403);
		expect(html).not.toContain("<h2>History</h2>");
	});

	it("does not tell another user whether a session id exists", async () => {
		const { client, db } = createTestDatabase("session-page-forbidden-unknown");
		const user = insertUser(client, "firstuser");
		const stranger = insertUser(client, "seconduser");
		const current = await createSession(user.id, db);

		const { response } = await renderSessionPage(db, current.id, stranger.username, "no-such-session");

		expect(response.status).toBe(403);
	});

	it("lets an admin open another user's session", async () => {
		const { client, db } = createTestDatabase("session-page-admin");
		const admin = insertUser(client, "firstuser", "admin");
		const stranger = insertUser(client, "seconduser");
		const current = await createSession(admin.id, db);
		const strangerSession = await createSession(stranger.id, db);
		client.insert(history)
			.values({ sessionId: strangerSession.id, requestedAt: new Date(), method: "GET", route: "/explore", path: "/explore", status: 200 })
			.run();

		const { response, html } = await renderSessionPage(db, current.id, stranger.username, strangerSession.id);

		expect(response.status).toBe(200);
		expect(html).toContain("<h2>History</h2>");
		expect(html).toContain("/explore</span>");
	});

	it("marks the requests that were prefetched", async () => {
		const { client, db } = createTestDatabase("session-page-prefetched");
		const user = insertUser(client, "firstuser");
		const current = await createSession(user.id, db);
		const request = { sessionId: current.id, method: "GET", route: "/explore", status: 200 };
		client.insert(history)
			.values([
				{ ...request, requestedAt: new Date(2000), path: "/prefetched", prefetched: true },
				{ ...request, requestedAt: new Date(1000), path: "/opened" },
			])
			.run();

		const { html } = await renderSessionPage(db, current.id, user.username, current.id);

		const rows = html.match(/<li\b.*?<\/li>/gs) ?? [];
		const row = (path: string) => rows.find((li) => li.includes(`${path}</span>`));
		expect(row("/prefetched")).toMatch(/>\s*PRE\s*</);
		expect(row("/prefetched")).not.toMatch(/>\s*GET\s*</);
		expect(row("/opened")).toMatch(/>\s*GET\s*</);
		expect(row("/opened")).not.toMatch(/>\s*PRE\s*</);
	});

	it("shows only the newest page of requests and links to the older ones", async () => {
		const { client, db } = createTestDatabase("session-page-limit");
		const user = insertUser(client, "firstuser");
		const current = await createSession(user.id, db);
		const total = defaultPageSize + 5;
		insertRequests(client, current.id, total);

		const { html } = await renderSessionPage(db, current.id, user.username, current.id);

		expect(html.match(/\/request-\d+<\/span>/g)).toHaveLength(defaultPageSize);
		expect(html).toContain("/request-0</span>");
		expect(html).toContain(`/request-${defaultPageSize - 1}</span>`);
		expect(html).not.toContain(`/request-${defaultPageSize}</span>`);
		expect(html).toContain(`<dd class="t-body font-medium">${total}</dd>`);

		expect(linkQuery(html, "prev")).toBeUndefined();
		const query = linkQuery(html, "next");
		expect(query).toMatch(/^\?before=\d+$/);

		const older = await renderSessionPage(db, current.id, user.username, current.id, query);

		expect(older.html).toContain(`/request-${defaultPageSize}</span>`);
		expect(older.html).toContain(`/request-${total - 1}</span>`);
		expect(older.html).not.toContain("/request-0</span>");
		expect(linkQuery(older.html, "next")).toBeUndefined();

		const newerQuery = linkQuery(older.html, "prev");
		expect(newerQuery).toMatch(/^\?after=\d+$/);

		const newer = await renderSessionPage(db, current.id, user.username, current.id, newerQuery);

		expect(newer.html.match(/\/request-\d+<\/span>/g)).toHaveLength(defaultPageSize);
		expect(newer.html).toContain("/request-0</span>");
		expect(newer.html).toContain(`/request-${defaultPageSize - 1}</span>`);
		expect(newer.html.indexOf("/request-0</span>")).toBeLessThan(newer.html.indexOf("/request-1</span>"));
		expect(linkQuery(newer.html, "prev")).toBeUndefined();
		expect(linkQuery(newer.html, "next")).toMatch(/^\?before=\d+$/);
	});

	it("shows the chosen number of rows per page and keeps it when paging", async () => {
		const { client, db } = createTestDatabase("session-page-rows");
		const user = insertUser(client, "firstuser");
		const current = await createSession(user.id, db);
		insertRequests(client, current.id, 30);

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
		const { client, db } = createTestDatabase("session-page-rows-invalid");
		const user = insertUser(client, "firstuser");
		const current = await createSession(user.id, db);
		insertRequests(client, current.id, defaultPageSize + 1);

		const { html } = await renderSessionPage(db, current.id, user.username, current.id, "?rows=100000");

		expect(html.match(/\/request-\d+<\/span>/g)).toHaveLength(defaultPageSize);
	});

	it("links back to the newest requests from a page past the oldest one", async () => {
		const { client, db } = createTestDatabase("session-page-past-end");
		const user = insertUser(client, "firstuser");
		const current = await createSession(user.id, db);
		client.insert(history)
			.values({ sessionId: current.id, requestedAt: new Date(), method: "GET", route: "/explore", path: "/explore", status: 200 })
			.run();

		const { html } = await renderSessionPage(db, current.id, user.username, current.id, "?before=1");

		expect(html).toContain("There are no older requests.");
		expect(linkQuery(html, "prev")).toBe("");
		expect(linkQuery(html, "next")).toBeUndefined();
	});

	it("numbers another device in the order it signed in", async () => {
		const { client, db } = createTestDatabase("session-page-device-name");
		const user = insertUser(client, "firstuser");
		const stranger = insertUser(client, "seconduser");
		const strangerSession = await createSession(stranger.id, db);
		const later = await createSession(user.id, db);
		const earlier = await createSession(user.id, db);
		const current = await createSession(user.id, db);
		const signIn = (id: string, ms: number) =>
			client.update(sessions).set({ createdAt: new Date(ms) }).where(eq(sessions.id, id)).run();
		signIn(strangerSession.id, 1000);
		signIn(earlier.id, 2000);
		signIn(later.id, 3000);
		signIn(current.id, 4000);

		const { html } = await renderSessionPage(db, current.id, user.username, later.id);

		expect(html).toContain("<h1>Device 2</h1>");
	});
});
