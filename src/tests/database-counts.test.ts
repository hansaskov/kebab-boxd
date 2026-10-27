import { describe, expect, it } from "vitest";
import { createTestDatabase, insertRestaurant, insertUser } from "@src/tests/database";

describe("admin.countOverview", () => {
	it("counts the users and restaurants of every group with one statement", async () => {
		const { client, db, recordQueries } = createTestDatabase("counts-overview");
		const admin = insertUser(client, "ada", "admin");
		const bob = insertUser(client, "bob");
		insertUser(client, "cleo");
		insertRestaurant(client, "Bosporus Grill", { status: "approved" });
		insertRestaurant(client, "Mangal Express");
		insertRestaurant(client, "Dergah Kebab");
		await db.mutations.users.ban(admin.id, bob.username);

		const { result, queries } = await recordQueries(() => db.queries.admin.countOverview());

		expect(result).toEqual({ all: 3, admin: 1, banned: 1, approved: 1, pending: 2, rejected: 0 });
		expect(queries).toHaveLength(1);
	});
});

describe("restaurants.countByStatus", () => {
	it("counts the restaurants of each status with one statement", async () => {
		const { client, db, recordQueries } = createTestDatabase("counts-restaurants");
		insertRestaurant(client, "Bosporus Grill", { status: "rejected" });

		const { result, queries } = await recordQueries(() => db.queries.restaurants.countByStatus());

		expect(result).toEqual({ approved: 0, pending: 0, rejected: 1 });
		expect(queries).toHaveLength(1);
	});
});

describe("users.list", () => {
	it("reads the first page and the number of matching users with one statement", async () => {
		const { client, db, recordQueries } = createTestDatabase("counts-user-list");
		for (const name of ["ada", "adam", "adrian", "bob"]) insertUser(client, name);

		const { result, queries } = await recordQueries(() => db.queries.users.list({ search: "ad", filter: "all" }, { limit: 2, cursor: undefined }));

		expect(result.items.map((user) => user.username)).toEqual(["adrian", "adam"]);
		expect(result.total).toBe(3);
		expect(queries).toHaveLength(1);
	});
});
