import { describe, expect, it } from "vitest";
import type { Database } from "@src/db";
import { callDatabaseAll, connectDatabase, loadingOnce, localDatabase, type Query } from "@src/db/remote";
import { storedPictureNames } from "@src/tests/cloudflare";
import { allowed, createTestDatabase, firstPage, insertRestaurant, insertUser } from "@src/tests/database";
import { pictureFile } from "@src/tests/pictures";

function connectOverClone(db: Database) {
	const loads: number[] = [];
	const remote = connectDatabase({
		call: async (calls) => {
			loads.push(calls.length);
			return { values: structuredClone(await callDatabaseAll(db, structuredClone(calls))), wokeUp: false };
		},
	});
	return { remote, loads };
}

describe("The database over RPC", () => {
	it("writes a review with its pictures and reads it back", async () => {
		const { client, db } = createTestDatabase();
		const ada = insertUser(client, "ada");
		const grill = insertRestaurant(client, "Bosporus Grill", { status: "approved" });
		const { remote } = connectOverClone(db);

		const result = await remote.load(remote.reviews.create(ada.id, grill.id, { rating: 8, description: "Crisp." }, [await pictureFile()]));
		const page = allowed(await remote.load(remote.reviews.listByRestaurant(grill.id, ada.id, firstPage)));

		expect(result).toMatchObject({ id: expect.any(Number) });
		expect(page.items).toEqual([expect.objectContaining({ rating: 8, description: "Crisp.", createdAt: expect.any(Date) })]);
		expect(await storedPictureNames()).toHaveLength(1);
	});

	it("refuses a method the database does not have", async () => {
		const { db } = createTestDatabase();
		const { remote } = connectOverClone(db);
		const missing = (remote.users as unknown as { constructor: () => Query<unknown> }).constructor();

		await expect(remote.load(missing)).rejects.toThrow("The database has no method users.constructor.");
	});

	it("sends the queries of one load in one call, and leaves out those that are not needed", async () => {
		const { client, db } = createTestDatabase();
		const ada = insertUser(client, "ada");
		const grill = insertRestaurant(client, "Bosporus Grill", { status: "approved" });
		const { remote, loads } = connectOverClone(db);

		const loaded = await remote.load({
			restaurant: remote.restaurants.findById(grill.id, ada.id),
			user: remote.users.findByUsername("ADA"),
			nothing: undefined,
		});

		expect(loads).toEqual([2]);
		expect(loaded).toEqual({ restaurant: expect.objectContaining({ name: "Bosporus Grill" }), user: expect.objectContaining({ username: "ada" }), nothing: undefined });
	});

	it("sends nothing for a load with no queries", async () => {
		const { db } = createTestDatabase();
		const { remote, loads } = connectOverClone(db);

		expect(await remote.load({ nothing: undefined })).toEqual({ nothing: undefined });
		expect(loads).toEqual([]);
	});
});

describe("A page", () => {
	it("loads from the database once", async () => {
		const { client, db } = createTestDatabase();
		insertUser(client, "ada");
		const page = loadingOnce(localDatabase(db));

		await page.load(page.users.findByUsername("ada"));

		await expect(page.load(page.users.findByUsername("ada"))).rejects.toThrow("A page loads from the database once.");
	});
});
