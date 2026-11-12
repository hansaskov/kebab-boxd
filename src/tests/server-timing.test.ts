import { describe, expect, it } from "vitest";
import { callDatabase, connectDatabase } from "@src/db/remote";
import { measuringDatabase } from "@src/middleware/server-timing";
import { createTestDatabase, insertUser } from "@src/tests/database";

describe("the Server-Timing header", () => {
	it("counts the calls of a request, and as one trip the calls it waited for together", async () => {
		const { client, db } = createTestDatabase();
		insertUser(client, "ada");
		const measured = measuringDatabase({ call: (area, method, args) => callDatabase(db, area, method, args) });
		const remote = connectDatabase(measured.rpc);

		await Promise.all([remote.users.findByUsername("ada"), remote.users.countByFilter()]);
		await remote.restaurants.countByStatus();

		expect(measured.header()).toMatch(/^db;dur=\d+\.\d;desc="2 trips, 3 calls"$/);
	});
});
