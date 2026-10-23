import { describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { createSession } from "@src/auth/session";
import { sessions } from "@src/db/schema";
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
});
