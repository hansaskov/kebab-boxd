import { describe, expect, it } from "vitest";
import { createSession, getSession } from "@src/auth/session";
import { createDrizzleDatabase, migrateDrizzleDatabase } from "@src/db";
import type { DB } from "@src/db";
import { history, users } from "@src/db/schema";
import { historyMiddleware } from "@src/middleware/history";

function createTestDb(name: string) {
	const db = createDrizzleDatabase(`file:${name}?mode=memory`);
	migrateDrizzleDatabase(db);
	return db;
}

async function insertSession(db: DB, username = "ada") {
	const user = db
		.insert(users)
		.values({ fullname: `${username} user`, username, email: `${username}@example.com` })
		.returning()
		.get();
	return createSession(user.id, db);
}

async function runMiddleware(
	db: DB,
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
	it("returns the response before the entry is written", async () => {
		const db = createTestDb("history-middleware-deferred");
		const session = await getSession((await insertSession(db)).id, db);
		const context = {
			isPrerendered: false,
			request: new Request("http://localhost/"),
			url: new URL("http://localhost/"),
			routePattern: "/",
			locals: { db, session },
		};

		await historyMiddleware(context as unknown as Parameters<typeof historyMiddleware>[0], async () => new Response());
		expect(await db.$count(history)).toBe(0);

		await new Promise((resolve) => setImmediate(resolve));
		expect(await db.$count(history)).toBe(1);
	});

	it("records page views and form actions with their status", async () => {
		const db = createTestDb("history-middleware-record");
		const session = await insertSession(db);

		await runMiddleware(db, session.id, "http://localhost/ada/settings", {
			routePattern: "/[username]/settings",
		});
		await new Promise((resolve) => setTimeout(resolve, 2));
		await runMiddleware(db, session.id, "http://localhost/ada/settings?_action=updateProfile", {
			method: "POST",
			routePattern: "/[username]/settings",
			status: 302,
		});

		const rows = await db
			.select({ method: history.method, route: history.route, path: history.path, action: history.action, status: history.status })
			.from(history)
			.orderBy(history.requestedAt);
		expect(rows).toEqual([
			{ method: "GET", route: "/[username]/settings", path: "/ada/settings", action: null, status: 200 },
			{ method: "POST", route: "/[username]/settings", path: "/ada/settings", action: "updateProfile", status: 302 },
		]);
	});

	it("skips prefetch requests", async () => {
		const db = createTestDb("history-middleware-prefetch");
		const session = await insertSession(db);

		await runMiddleware(db, session.id, "http://localhost/explore", {
			routePattern: "/explore",
			headers: { "Sec-Purpose": "prefetch" },
		});
		await runMiddleware(db, session.id, "http://localhost/reviews", {
			routePattern: "/reviews",
			headers: { "Sec-Purpose": "prefetch;prerender" },
		});

		expect(await db.$count(history)).toBe(0);
	});

	it("skips visitors without a session", async () => {
		const db = createTestDb("history-middleware-anonymous");

		await runMiddleware(db, null, "http://localhost/", { routePattern: "/" });

		expect(await db.$count(history)).toBe(0);
	});
});
