import { describe, expect, it } from "vitest";
import { createSession } from "@src/auth/session";
import { historyRetentionSeconds, inactivityTimeoutSeconds } from "@src/data/retention-periods";
import * as s from "@src/db/schema";
import { createTestDatabase, insertUser } from "@src/tests/database";

const now = new Date("2026-10-23T12:00:00Z");

function secondsBeforeNow(seconds: number) {
	return new Date(now.getTime() - seconds * 1000);
}

describe("the retention purge", () => {
	it("deletes the sessions that timed out with their history, and the history older than the retention period", async () => {
		const { client, db } = createTestDatabase();
		const ada = insertUser(client, "ada");
		const expired = await createSession(ada.id, db);
		const active = await createSession(ada.id, db);
		await db.sessions.setLastVerifiedAt(expired.id, secondsBeforeNow(inactivityTimeoutSeconds));
		await db.sessions.setLastVerifiedAt(active.id, secondsBeforeNow(inactivityTimeoutSeconds - 1));
		const request = { method: "GET", route: "/", path: "/", status: 200 };
		client.insert(s.history).values([
			{ ...request, sessionId: expired.id, requestedAt: now },
			{ ...request, sessionId: active.id, requestedAt: secondsBeforeNow(historyRetentionSeconds + 1) },
			{ ...request, sessionId: active.id, requestedAt: secondsBeforeNow(historyRetentionSeconds) },
		]).run();

		await db.retention.purge(now);

		expect(client.query.sessions.findMany({ columns: { id: true } }).sync()).toEqual([{ id: active.id }]);
		expect(client.query.history.findMany({ columns: { sessionId: true, requestedAt: true } }).sync()).toEqual([
			{ sessionId: active.id, requestedAt: secondsBeforeNow(historyRetentionSeconds) },
		]);
	});
});
