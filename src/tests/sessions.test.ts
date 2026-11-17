import { describe, expect, it } from "vitest";
import { createSession, findSession } from "@src/auth/session";
import { inactivityTimeoutSeconds } from "@src/privacy/retention";
import { createTestDatabase, insertUser, setLastVerifiedAt } from "@src/tests/database";

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
		setLastVerifiedAt(client, returning.id, new Date(timeoutAgo().getTime() + 60_000));
		setLastVerifiedAt(client, gone.id, timeoutAgo());

		const found = await findSession(db, returning.token);

		expect(found?.lastVerifiedAt.getTime()).toBeGreaterThan(Date.now() - 60_000);
		expect(await findSession(db, returning.token)).not.toBeNull();
		expect(await findSession(db, gone.token)).toBeNull();
	});

	it("gives the outcome of a form to the page after it once, and keeps the hash of its secret to itself", async () => {
		const { client, db } = createTestDatabase();
		const ada = insertUser(client, "ada");
		const { id, token } = await createSession(db, ada.id);
		await db.sessions.setActionData(id, { name: "reviews.like", target: 7 });

		const kept = await db.sessions.open(token, { takeActionOutcome: false });
		const taken = await db.sessions.open(token, { takeActionOutcome: true });
		const again = await db.sessions.open(token, { takeActionOutcome: true });

		expect([kept?.actionOutcome, taken?.actionOutcome, again?.actionOutcome]).toEqual([null, { name: "reviews.like", target: 7 }, null]);
		expect(taken).not.toHaveProperty("secretHash");
	});
});
