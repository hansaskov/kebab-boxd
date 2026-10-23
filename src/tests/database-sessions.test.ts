import { describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { createSession } from "@src/auth/session";
import { history, sessions } from "@src/db/schema";
import { createTestDatabase, insertUser } from "@src/tests/database";

describe("sessions.listActive and sessions.findActive", () => {
	it("compare dates with the inactivity cutoff the way the column stores them", async () => {
		const { client, db } = createTestDatabase("sessions-active");
		const user = insertUser(client, "ada");
		const active = await createSession(user.id, db);
		const timedOut = await createSession(user.id, db);
		client
			.update(sessions)
			.set({ lastVerifiedAt: new Date(Date.now() - 31 * 24 * 60 * 60 * 1000) })
			.where(eq(sessions.id, timedOut.id))
			.run();

		expect((await db.queries.sessions.listActive(user.id)).map((session) => session.id)).toEqual([active.id]);
		expect(await db.queries.sessions.findActive(active.id, user.id)).toBeDefined();
		expect(await db.queries.sessions.findActive(timedOut.id, user.id)).toBeUndefined();
	});

	it("lists the devices by their last request, newest first, with the number of requests", async () => {
		const { client, db } = createTestDatabase("sessions-last-request");
		const user = insertUser(client, "ada");
		const [first, second, unused] = [await createSession(user.id, db), await createSession(user.id, db), await createSession(user.id, db)];
		const request = { method: "GET", route: "/", path: "/", status: 200 };
		const minutesAgo = (minutes: number) => new Date(Date.now() - minutes * 60 * 1000);
		client
			.insert(history)
			.values([
				{ ...request, sessionId: first!.id, requestedAt: minutesAgo(3) },
				{ ...request, sessionId: first!.id, requestedAt: minutesAgo(1) },
				{ ...request, sessionId: second!.id, requestedAt: minutesAgo(2) },
			])
			.run();

		const devices = await db.queries.sessions.listActive(user.id);

		expect(devices.map((device) => device.id)).toEqual([first!.id, second!.id, unused!.id]);
		expect(devices.map((device) => device.requestCount)).toEqual([2, 1, 0]);
		expect(devices.map((device) => device.history.at(0)?.requestedAt)).toEqual([minutesAgo(1), minutesAgo(2), undefined]);
		expect(devices.map((device) => device.signInOrder).toSorted()).toEqual([1, 2, 3]);
	});
});
