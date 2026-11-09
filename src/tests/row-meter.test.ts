import { describe, expect, it } from "vitest";
import { openLargeDatabase } from "@src/tests/durable-database";

describe("the count of the rows a call reads", () => {
	it("counts for each call only its own rows, also while another call runs as it waits", async () => {
		const db = await openLargeDatabase(1);

		const { rows, users, restaurants } = await db.meterOverlappingWork();

		expect(rows).toEqual({
			users: { rowsRead: 2 * users, rowsWritten: 0 },
			restaurants: { rowsRead: 2 * restaurants, rowsWritten: 0 },
		});
	});
});
