import { describe, expect, it } from "vitest";
import { createSession } from "@src/auth/session";
import type { Database } from "@src/db";
import type { Client } from "@src/db/client";
import { history } from "@src/db/schema";
import type { Cursor } from "@src/pagination";
import { createTestDatabase, insertUser } from "@src/tests/database";

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

async function setUp(name: string, total: number) {
	const { client, db } = createTestDatabase(name);
	const session = await createSession(insertUser(client, "ada").id, db);
	insertRequests(client, session.id, total);
	return { client, db, sessionId: session.id };
}

async function listPage(db: Database, sessionId: string, limit: number, cursor?: Cursor) {
	const page = await db.queries.history.listBySession(sessionId, { limit, cursor });
	return { ...page, items: page.items.map((entry) => entry.path) };
}

const at = (seconds: number) => String(seconds * 1000);

describe("history.listBySession", () => {
	it("pages from the newest request to the oldest and back again", async () => {
		const { db, sessionId } = await setUp("history-list-walk", 5);

		const first = await listPage(db, sessionId, 2);
		const second = await listPage(db, sessionId, 2, first.next);
		const third = await listPage(db, sessionId, 2, second.next);
		const backToSecond = await listPage(db, sessionId, 2, third.previous);
		const backToFirst = await listPage(db, sessionId, 2, backToSecond.previous);

		expect(first).toEqual({ items: ["/request-5", "/request-4"], previous: undefined, next: { after: at(4) }, isPastEnd: false });
		expect(second).toEqual({ items: ["/request-3", "/request-2"], previous: { before: at(3) }, next: { after: at(2) }, isPastEnd: false });
		expect(third).toEqual({ items: ["/request-1"], previous: { before: at(1) }, next: undefined, isPastEnd: false });
		expect(backToSecond).toEqual(second);
		expect(backToFirst).toEqual(first);
	});

	it("links back from a page past the oldest request", async () => {
		const { db, sessionId } = await setUp("history-list-past-end", 3);

		expect(await listPage(db, sessionId, 2, { after: at(1) })).toEqual({
			items: [],
			previous: { before: at(1) },
			next: undefined,
			isPastEnd: true,
		});
	});

	it("lists only the requests of that session", async () => {
		const { client, db, sessionId } = await setUp("history-list-session", 2);
		const other = await createSession(insertUser(client, "bob").id, db);
		insertRequests(client, other.id, 3);

		expect((await listPage(db, sessionId, 10)).items).toEqual(["/request-2", "/request-1"]);
	});
});
