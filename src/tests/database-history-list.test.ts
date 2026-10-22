import { describe, expect, it } from "vitest";
import { createSession } from "@src/auth/session";
import type { Database } from "@src/db";
import type { Client } from "@src/db/client";
import { history } from "@src/db/schema";
import type { Cursor } from "@src/pagination";
import { createTestDatabase, insertUser } from "@src/tests/database";

function insertRequests(client: Client, sessionId: string, total: number) {
	if (total === 0) return;
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
	const user = insertUser(client, "ada");
	const session = await createSession(user.id, db);
	insertRequests(client, session.id, total);
	return { client, db, sessionId: session.id };
}

async function listPage(db: Database, sessionId: string, limit: number, cursor?: Cursor) {
	const page = await db.queries.history.listBySession(sessionId, { limit, cursor });
	return {
		paths: page.items.map((entry) => entry.path),
		previous: page.previous,
		next: page.next,
		isPastEnd: page.isPastEnd,
	};
}

const at = (seconds: number) => String(seconds * 1000);

describe("history.listBySession", () => {
	it("reads the newest requests first, and where the next page starts", async () => {
		const { db, sessionId } = await setUp("history-list-first", 5);

		expect(await listPage(db, sessionId, 2)).toEqual({
			paths: ["/request-5", "/request-4"],
			previous: undefined,
			next: { after: at(4) },
			isPastEnd: false,
		});
	});

	it("pages through older requests and back again", async () => {
		const { db, sessionId } = await setUp("history-list-walk", 5);

		const second = await listPage(db, sessionId, 2, { after: at(4) });
		const third = await listPage(db, sessionId, 2, { after: at(2) });
		const backToSecond = await listPage(db, sessionId, 2, { before: at(1) });

		expect(second).toEqual({ paths: ["/request-3", "/request-2"], previous: { before: at(3) }, next: { after: at(2) }, isPastEnd: false });
		expect(third).toEqual({ paths: ["/request-1"], previous: { before: at(1) }, next: undefined, isPastEnd: false });
		expect(backToSecond).toEqual(second);
	});

	it("has no next page when the last page is exactly full", async () => {
		const { db, sessionId } = await setUp("history-list-exact", 4);

		expect((await listPage(db, sessionId, 2, { after: at(3) })).next).toBeUndefined();
	});

	it("shows the full first page when going back reaches the newest request", async () => {
		const { db, sessionId } = await setUp("history-list-back-to-start", 5);

		expect(await listPage(db, sessionId, 2, { before: at(4) })).toEqual(await listPage(db, sessionId, 2));
		expect(await listPage(db, sessionId, 2, { before: at(99) })).toEqual(await listPage(db, sessionId, 2));
	});

	it("links back from a page past the oldest request", async () => {
		const { db, sessionId } = await setUp("history-list-past-end", 3);

		expect(await listPage(db, sessionId, 2, { after: at(1) })).toEqual({
			paths: [],
			previous: { before: at(1) },
			next: undefined,
			isPastEnd: true,
		});
	});

	it("lists only the requests of that session", async () => {
		const { client, db, sessionId } = await setUp("history-list-session", 2);
		const other = await createSession(insertUser(client, "bob").id, db);
		insertRequests(client, other.id, 3);

		expect((await listPage(db, sessionId, 10)).paths).toEqual(["/request-2", "/request-1"]);
	});

	it("has nothing on either side in an empty history", async () => {
		const { db, sessionId } = await setUp("history-list-empty", 0);

		expect(await listPage(db, sessionId, 2)).toEqual({ paths: [], previous: undefined, next: undefined, isPastEnd: false });
		expect(await listPage(db, sessionId, 2, { after: at(1) })).toEqual({
			paths: [],
			previous: undefined,
			next: undefined,
			isPastEnd: true,
		});
	});

	it.each(["abc", "1.5", "9007199254740993"])("reads the first page for the cursor %s, which it cannot have written", async (cursor) => {
		const { db, sessionId } = await setUp(`history-list-bad-cursor-${cursor}`, 3);

		expect(await listPage(db, sessionId, 2, { after: cursor })).toEqual(await listPage(db, sessionId, 2));
		expect(await listPage(db, sessionId, 2, { before: cursor })).toEqual(await listPage(db, sessionId, 2));
	});
});
