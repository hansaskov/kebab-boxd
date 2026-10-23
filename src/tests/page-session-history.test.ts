import { experimental_AstroContainer as AstroContainer } from "astro/container";
import { describe, expect, it } from "vitest";
import SessionPage from "@src/pages/[username]/settings/sessions/[sessionId].astro";
import ForbiddenPage from "@src/pages/403.astro";
import NotFoundPage from "@src/pages/404.astro";
import { eq } from "drizzle-orm";
import { createSession, type SessionWithUser } from "@src/auth/session";
import type { Database } from "@src/db";
import type { Client } from "@src/db/client";
import { history, sessions } from "@src/db/schema";
import { createTestDatabase, insertUser, signIn } from "@src/tests/database";

function insertRequests(client: Client, sessionId: string, total: number) {
	client
		.insert(history)
		.values(
			Array.from({ length: total }, (_, i) => ({
				sessionId,
				requestedAt: new Date((i + 1) * 1000),
				method: "GET",
				route: "/explore",
				path: `/request-${i + 1}`,
				status: 200,
			})),
		)
		.run();
}

const day = 24 * 60 * 60 * 1000;

function listedPaths(html: string) {
	return [...html.matchAll(/class="t-body min-w-0 truncate">\s*([^<\s]+)/g)].map((match) => match[1]);
}

function pageSearch(html: string, rel: "prev" | "next") {
	const href = html.match(new RegExp(`rel="${rel}" href="([^"]*)"`))?.[1]?.replaceAll("&amp;", "&");
	return href && new URL(href, "http://localhost").search;
}

async function renderSessionPage(db: Database, viewer: SessionWithUser, username: string, sessionId: string, search = "") {
	const container = await AstroContainer.create();
	container.insertPageRoute("/403", ForbiddenPage);
	container.insertPageRoute("/404", NotFoundPage);
	const response = await container.renderToResponse(SessionPage, {
		locals: { db, session: viewer },
		params: { username, sessionId },
		request: new Request(`http://localhost/${username}/settings/sessions/${sessionId}${search}`),
	});
	return { response, html: await response.text() };
}

describe("SessionPage", () => {
	it("pages through the requests of the session from the newest to the oldest and back again", async () => {
		const { client, db } = createTestDatabase("session-page-history");
		const ada = insertUser(client, "ada");
		const session = await signIn(db, ada.id);
		const other = await createSession(ada.id, db);
		insertRequests(client, session.id, 12);
		insertRequests(client, other.id, 3);
		const paths = Array.from({ length: 12 }, (_, i) => `/request-${12 - i}`);

		const first = await renderSessionPage(db, session, "ada", session.id, "?rows=10");
		const second = await renderSessionPage(db, session, "ada", session.id, pageSearch(first.html, "next"));
		const back = await renderSessionPage(db, session, "ada", session.id, pageSearch(second.html, "prev"));

		expect(first.html).toMatch(/Requests<\/dt>\s*<dd[^>]*>12<\/dd>/);
		expect(listedPaths(first.html)).toEqual(paths.slice(0, 10));
		expect(listedPaths(second.html)).toEqual(paths.slice(10));
		expect(pageSearch(second.html, "next")).toBeUndefined();
		expect(listedPaths(back.html)).toEqual(paths.slice(0, 10));
	});

	it("tells that there are no older requests on a page past the oldest one", async () => {
		const { client, db } = createTestDatabase("session-page-past-end");
		const ada = insertUser(client, "ada");
		const session = await signIn(db, ada.id);
		insertRequests(client, session.id, 3);

		const { html } = await renderSessionPage(db, session, "ada", session.id, "?after=1000");

		expect(html).toContain("There are no older requests.");
		expect(pageSearch(html, "prev")).toBe("?before=1000");
	});

	it("does not show a session that timed out", async () => {
		const { client, db } = createTestDatabase("session-page-timed-out");
		const ada = insertUser(client, "ada");
		const session = await signIn(db, ada.id);
		const timedOut = await createSession(ada.id, db);
		client
			.update(sessions)
			.set({ lastVerifiedAt: new Date(Date.now() - 31 * day) })
			.where(eq(sessions.id, timedOut.id))
			.run();

		expect((await renderSessionPage(db, session, "ada", timedOut.id)).response.status).toBe(404);
	});

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

	it("sends a username in other letter case to the address of the user", async () => {
		const { client, db } = createTestDatabase("session-page-case");
		const ada = insertUser(client, "ada");
		const session = await signIn(db, ada.id);

		const { response } = await renderSessionPage(db, session, "Ada", session.id);

		expect(response.status).toBe(301);
		expect(response.headers.get("Location")).toBe(`/ada/settings/sessions/${session.id}`);
	});
});
