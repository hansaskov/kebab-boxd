import { describe, expect, it } from "vitest";
import { createSession, getSession } from "@src/auth/session";
import type { Database } from "@src/db";
import { history } from "@src/db/schema";
import { historyMiddleware } from "@src/middleware/history";
import { createTestDatabase, insertUser } from "@src/tests/database";

async function runMiddleware(
	db: Database,
	sessionId: string | null,
	url: string,
	init: RequestInit & { routePattern: string; status?: number },
) {
	const session = sessionId ? await getSession(sessionId, db) : null;
	const context = {
		isPrerendered: false,
		request: new Request(url, init),
		url: new URL(url),
		routePattern: init.routePattern,
		locals: { db, session: null as typeof session },
	};
	const result = await historyMiddleware(
		context as unknown as Parameters<typeof historyMiddleware>[0],
		async () => {
			context.locals.session = session;
			return new Response(null, { status: init.status ?? 200 });
		},
	);
	if (!(result instanceof Response)) throw new Error("History middleware did not return a response");
	await new Promise((resolve) => setImmediate(resolve));
	return result;
}

describe("historyMiddleware", () => {
	it("records page views and form actions with their status", async () => {
		const { client, db } = createTestDatabase("history-middleware-record");
		const session = await createSession(insertUser(client, "ada").id, db);

		await runMiddleware(db, session.id, "http://localhost/ada/settings", {
			routePattern: "/[username]/settings",
		});
		await new Promise((resolve) => setTimeout(resolve, 2));
		await runMiddleware(db, session.id, "http://localhost/ada/settings?_action=updateProfile", {
			method: "POST",
			routePattern: "/[username]/settings",
			status: 302,
		});

		const rows = await client
			.select({ method: history.method, route: history.route, path: history.path, action: history.action, status: history.status })
			.from(history)
			.orderBy(history.requestedAt);
		expect(rows).toEqual([
			{ method: "GET", route: "/[username]/settings", path: "/ada/settings", action: null, status: 200 },
			{ method: "POST", route: "/[username]/settings", path: "/ada/settings", action: "updateProfile", status: 302 },
		]);
	});

	it("records a rewritten request once, with the path the browser asked for", async () => {
		const { client, db } = createTestDatabase("history-middleware-rewrite");
		const session = await getSession((await createSession(insertUser(client, "ada").id, db)).id, db);
		const locals = { db, session };
		const contextFor = (url: string, routePattern: string) =>
			({
				isPrerendered: false,
				request: new Request(url),
				url: new URL(url),
				routePattern,
				locals,
			}) as unknown as Parameters<typeof historyMiddleware>[0];

		// Astro.rewrite("/404") runs the middleware again inside next(), with the same locals.
		await historyMiddleware(contextFor("http://localhost/nobody/settings", "/[username]/settings"), async () => {
			const rewritten = await historyMiddleware(contextFor("http://localhost/404", "/404"), async () =>
				new Response(null, { status: 404 }),
			);
			if (!(rewritten instanceof Response)) throw new Error("History middleware did not return a response");
			return rewritten;
		});
		await new Promise((resolve) => setImmediate(resolve));

		const rows = await client.select({ route: history.route, path: history.path, status: history.status }).from(history);
		expect(rows).toEqual([{ route: "/[username]/settings", path: "/nobody/settings", status: 404 }]);
	});
});
