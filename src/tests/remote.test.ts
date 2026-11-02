import { describe, expect, it } from "vitest";
import type { Database } from "@src/db";
import { callDatabase, connectDatabase } from "@src/db/remote";
import { storedPictureNames } from "@src/tests/cloudflare";
import { createTestDatabase, firstPage, insertRestaurant, insertUser } from "@src/tests/database";
import { pictureFile } from "@src/tests/pictures";

// The website reaches the database over RPC, which copies every argument with the structured clone algorithm.
function connectOverClone(db: Database) {
	return connectDatabase({ call: async (area, method, args) => structuredClone(await callDatabase(db, area, method, structuredClone(args))) });
}

describe("The database over RPC", () => {
	it("writes a review with its pictures and reads it back", async () => {
		const { client, db } = createTestDatabase();
		const ada = insertUser(client, "ada");
		const grill = insertRestaurant(client, "Bosporus Grill", { status: "approved" });
		const remote = connectOverClone(db);

		const result = await remote.reviews.create(ada.id, grill.id, { rating: 8, description: "Crisp." }, [await pictureFile()]);
		const page = await remote.reviews.listByRestaurant(grill.id, ada.id, firstPage);

		expect(result).toMatchObject({ id: expect.any(Number) });
		expect(page.items).toEqual([expect.objectContaining({ rating: 8, description: "Crisp.", createdAt: expect.any(Date) })]);
		expect(await storedPictureNames()).toHaveLength(1);
	});

	it("refuses a method the database does not have", async () => {
		const { db } = createTestDatabase();
		const remote = connectOverClone(db) as unknown as { users: { constructor: () => Promise<unknown> } };

		await expect(remote.users.constructor()).rejects.toThrow("The database has no method users.constructor.");
	});
});
