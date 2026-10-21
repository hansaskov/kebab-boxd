import { describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { users } from "@src/db/schema";
import type { UserListPage } from "@src/db/queries/users";
import { banAs, createTestDatabase, insertUser } from "@src/tests/database";

const firstPage: UserListPage = { search: "", filter: "all", limit: 25, offset: 0 };

describe("users.list", () => {
	it("lists the newest users first, a page at a time, with the total", async () => {
		const { client, db } = createTestDatabase("user-list-pages");
		for (const name of ["ada", "bob", "cyd", "dan", "eve"]) {
			insertUser(client, name);
		}

		const first = await db.queries.users.list({ ...firstPage, limit: 2 });
		const last = await db.queries.users.list({ ...firstPage, limit: 2, offset: 4 });

		expect(first.users.map((user) => user.username)).toEqual(["eve", "dan"]);
		expect(first.total).toBe(5);
		expect(last.users.map((user) => user.username)).toEqual(["ada"]);
		expect(last.total).toBe(5);
	});

	it("finds users by part of their username, name or email, ignoring case", async () => {
		const { client, db } = createTestDatabase("user-list-search");
		insertUser(client, "kebabking");
		insertUser(client, "falafel");
		client.update(users).set({ fullname: "Döner Lover", email: "x@grill.dk" }).where(eq(users.username, "falafel")).run();

		const byUsername = await db.queries.users.list({ ...firstPage, search: "KEBAB" });
		const byName = await db.queries.users.list({ ...firstPage, search: "lover" });
		const byEmail = await db.queries.users.list({ ...firstPage, search: "grill.dk" });

		expect(byUsername.users.map((user) => user.username)).toEqual(["kebabking"]);
		expect(byName.users.map((user) => user.username)).toEqual(["falafel"]);
		expect(byEmail.users.map((user) => user.username)).toEqual(["falafel"]);
	});

	it("takes % and _ in the search text literally", async () => {
		const { client, db } = createTestDatabase("user-list-search-wildcards");
		insertUser(client, "ada_1");
		insertUser(client, "ada11");

		const underscore = await db.queries.users.list({ ...firstPage, search: "a_1" });
		const percent = await db.queries.users.list({ ...firstPage, search: "%" });

		expect(underscore.users.map((user) => user.username)).toEqual(["ada_1"]);
		expect(underscore.total).toBe(1);
		expect(percent.users).toEqual([]);
		expect(percent.total).toBe(0);
	});

	it("lists only admins or only banned users when asked", async () => {
		const { client, db } = createTestDatabase("user-list-filter");
		const ada = insertUser(client, "ada", "admin");
		const bob = insertUser(client, "bob");
		insertUser(client, "cyd");
		await banAs(db, ada.id, bob.id);

		const admins = await db.queries.users.list({ ...firstPage, filter: "admin" });
		const banned = await db.queries.users.list({ ...firstPage, filter: "banned" });

		expect(admins.users.map((user) => user.username)).toEqual(["ada"]);
		expect(admins.total).toBe(1);
		expect(banned.users.map((user) => user.username)).toEqual(["bob"]);
		expect(banned.total).toBe(1);
	});
});

describe("users.countByFilter", () => {
	it("counts every user, the admins and the banned users", async () => {
		const { client, db } = createTestDatabase("user-count-by-filter");
		const ada = insertUser(client, "ada", "admin");
		const bob = insertUser(client, "bob");
		const cyd = insertUser(client, "cyd");
		insertUser(client, "dan");
		await banAs(db, ada.id, bob.id);
		await banAs(db, ada.id, cyd.id);

		expect(await db.queries.users.countByFilter()).toEqual({ all: 4, admin: 1, banned: 2 });
	});

	it("counts nothing in an empty database", async () => {
		const { db } = createTestDatabase("user-count-by-filter-empty");

		expect(await db.queries.users.countByFilter()).toEqual({ all: 0, admin: 0, banned: 0 });
	});
});
