import { describe, expect, it } from "vitest";
import { createTestDatabase, insertUser } from "@src/tests/database";

describe("users.list", () => {
	it("matches percent signs and underscores in the search literally", async () => {
		const { client, db } = createTestDatabase("users-search-wildcards");
		insertUser(client, "kebab_king");
		insertUser(client, "kebabxking");
		insertUser(client, "falafel");

		const underscore = await db.queries.users.list({ search: "b_k", filter: "all" }, { limit: 10, cursor: undefined });
		const percent = await db.queries.users.list({ search: "%", filter: "all" }, { limit: 10, cursor: undefined });

		expect(underscore.items.map((user) => user.username)).toEqual(["kebab_king"]);
		expect(underscore.total).toBe(1);
		expect(percent.items).toEqual([]);
		expect(percent.total).toBe(0);
	});
});

describe("users.countByFilter", () => {
	it("counts all users, admins and banned users", async () => {
		const { client, db } = createTestDatabase("users-count-by-filter");
		const admin = insertUser(client, "root", "admin");
		const ada = insertUser(client, "ada");
		insertUser(client, "bob");
		await db.mutations.users.ban(ada.id, admin.id);

		expect(await db.queries.users.countByFilter()).toEqual({ all: 3, admin: 1, banned: 1 });
	});
});
