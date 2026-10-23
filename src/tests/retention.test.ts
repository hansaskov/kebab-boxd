import { describe, expect, it } from "vitest";
import { createSession } from "@src/auth/session";
import { historyRetentionSeconds, inactivityTimeoutSeconds } from "@src/data/retention-periods";
import * as s from "@src/db/schema";
import { createTestDatabase, insertUser } from "@src/tests/database";

const now = new Date("2026-10-23T12:00:00Z");

function secondsBeforeNow(seconds: number) {
	return new Date(now.getTime() - seconds * 1000);
}

describe("retention.purge", () => {
	it("deletes sessions that reached the inactivity timeout, with their history", async () => {
		const { client, db } = createTestDatabase("retention-sessions");
		const ada = insertUser(client, "ada");
		const expired = await createSession(ada.id, db);
		const active = await createSession(ada.id, db);
		await db.mutations.sessions.setLastVerifiedAt(expired.id, secondsBeforeNow(inactivityTimeoutSeconds));
		await db.mutations.sessions.setLastVerifiedAt(active.id, secondsBeforeNow(inactivityTimeoutSeconds - 1));
		client.insert(s.history)
			.values({ sessionId: expired.id, requestedAt: secondsBeforeNow(inactivityTimeoutSeconds), method: "GET", route: "/", path: "/", status: 200 })
			.run();

		const purged = await db.mutations.retention.purge(now);

		expect(purged).toEqual({ sessions: 1, history: 0 });
		expect(client.query.sessions.findMany({ columns: { id: true } }).sync()).toEqual([{ id: active.id }]);
		expect(client.query.history.findMany().sync()).toEqual([]);
	});

	it("deletes history older than the retention period from sessions that are still active", async () => {
		const { client, db } = createTestDatabase("retention-history");
		const ada = insertUser(client, "ada");
		const session = await createSession(ada.id, db);
		await db.mutations.sessions.setLastVerifiedAt(session.id, now);
		const request = { sessionId: session.id, method: "GET", route: "/", path: "/", status: 200 };
		client.insert(s.history).values([
			{ ...request, requestedAt: secondsBeforeNow(historyRetentionSeconds + 1) },
			{ ...request, requestedAt: secondsBeforeNow(historyRetentionSeconds) },
		]).run();

		const purged = await db.mutations.retention.purge(now);

		expect(purged).toEqual({ sessions: 0, history: 1 });
		expect(
			client.query.history.findMany({ columns: { requestedAt: true }, where: { sessionId: session.id } }).sync(),
		).toEqual([{ requestedAt: secondsBeforeNow(historyRetentionSeconds) }]);
	});
});
