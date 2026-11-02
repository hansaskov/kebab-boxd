import { describe, expect, it } from "vitest";
import { createSession, findSession } from "@src/auth/session";
import { inactivityTimeoutSeconds } from "@src/data/retention-periods";
import { createTestDatabase, insertUser } from "@src/tests/database";

describe("a session", () => {
	it("is found only with the secret of its token", async () => {
		const { client, db } = createTestDatabase();
		const ada = insertUser(client, "ada");
		const { id, token } = await createSession(db, ada.id);

		expect((await findSession(db, token))?.user.username).toBe("ada");
		for (const wrong of [`${id}.not-the-secret`, id, `${token}.more`, ""]) {
			expect(await findSession(db, wrong), wrong).toBeNull();
		}
	});

	it("lasts while its browser comes back within the inactivity timeout, and ends when it does not", async () => {
		const { client, db } = createTestDatabase();
		const ada = insertUser(client, "ada");
		const returning = await createSession(db, ada.id);
		const gone = await createSession(db, ada.id);
		const timeoutAgo = () => new Date(Date.now() - inactivityTimeoutSeconds * 1000);
		await db.sessions.setLastVerifiedAt(returning.id, new Date(timeoutAgo().getTime() + 60_000));
		await db.sessions.setLastVerifiedAt(gone.id, timeoutAgo());

		const found = await findSession(db, returning.token);

		expect(found?.lastVerifiedAt.getTime()).toBeGreaterThan(Date.now() - 60_000);
		expect(await findSession(db, returning.token)).not.toBeNull();
		expect(await findSession(db, gone.token)).toBeNull();
	});
});
