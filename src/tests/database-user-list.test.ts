import { describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { users } from "@src/db/schema";
import type { UserListCriteria } from "@src/db/queries/users";
import type { PageRequest } from "@src/pagination";
import { banAs, createTestDatabase, insertUser } from "@src/tests/database";

const everyone: UserListCriteria = { search: "", filter: "all" };
const firstPage: PageRequest = { limit: 25, cursor: undefined };

describe("users.list", () => {
	it("lists the newest users first, a page at a time, with the total", async () => {
		const { client, db } = createTestDatabase("user-list-pages");
		for (const name of ["ada", "bob", "cyd", "dan", "eve"]) {
			insertUser(client, name);
		}

		const first = await db.queries.users.list(everyone, { limit: 2, cursor: undefined });
		const second = await db.queries.users.list(everyone, { limit: 2, cursor: first.next });
		const last = await db.queries.users.list(everyone, { limit: 2, cursor: second.next });

		expect(first.items.map((user) => user.username)).toEqual(["eve", "dan"]);
		expect(first.total).toBe(5);
		expect(second.items.map((user) => user.username)).toEqual(["cyd", "bob"]);
		expect(last.items.map((user) => user.username)).toEqual(["ada"]);
		expect(last.next).toBeUndefined();
		expect(last.total).toBe(5);
	});

	it("finds users by part of their username, name or email, ignoring case", async () => {
		const { client, db } = createTestDatabase("user-list-search");
		insertUser(client, "kebabking");
		insertUser(client, "falafel");
		client.update(users).set({ fullname: "Döner Lover", email: "x@grill.dk" }).where(eq(users.username, "falafel")).run();

		const byUsername = await db.queries.users.list({ ...everyone, search: "KEBAB" }, firstPage);
		const byName = await db.queries.users.list({ ...everyone, search: "lover" }, firstPage);
		const byEmail = await db.queries.users.list({ ...everyone, search: "grill.dk" }, firstPage);

		expect(byUsername.items.map((user) => user.username)).toEqual(["kebabking"]);
		expect(byName.items.map((user) => user.username)).toEqual(["falafel"]);
		expect(byEmail.items.map((user) => user.username)).toEqual(["falafel"]);
	});

	it("takes % and _ in the search text literally", async () => {
		const { client, db } = createTestDatabase("user-list-search-wildcards");
		insertUser(client, "ada_1");
		insertUser(client, "ada11");

		const underscore = await db.queries.users.list({ ...everyone, search: "a_1" }, firstPage);
		const percent = await db.queries.users.list({ ...everyone, search: "%" }, firstPage);

		expect(underscore.items.map((user) => user.username)).toEqual(["ada_1"]);
		expect(underscore.total).toBe(1);
		expect(percent.items).toEqual([]);
		expect(percent.total).toBe(0);
	});

	it("lists only admins or only banned users when asked", async () => {
		const { client, db } = createTestDatabase("user-list-filter");
		const ada = insertUser(client, "ada", "admin");
		const bob = insertUser(client, "bob");
		insertUser(client, "cyd");
		await banAs(db, ada.id, bob.id);

		const admins = await db.queries.users.list({ ...everyone, filter: "admin" }, firstPage);
		const banned = await db.queries.users.list({ ...everyone, filter: "banned" }, firstPage);

		expect(admins.items.map((user) => user.username)).toEqual(["ada"]);
		expect(admins.total).toBe(1);
		expect(banned.items.map((user) => user.username)).toEqual(["bob"]);
		expect(banned.total).toBe(1);
	});
});

describe("users.list paging", () => {
	it("pages through only the users that match the search and filter", async () => {
		const { client, db } = createTestDatabase("user-list-search-pages");
		const ada = insertUser(client, "ada", "admin");
		for (const name of ["kebab_a", "falafel", "kebab_b", "kebab_c"]) {
			await banAs(db, ada.id, insertUser(client, name).id);
		}
		const criteria: UserListCriteria = { search: "kebab", filter: "banned" };

		const first = await db.queries.users.list(criteria, { limit: 2, cursor: undefined });
		const second = await db.queries.users.list(criteria, { limit: 2, cursor: first.next });
		const back = await db.queries.users.list(criteria, { limit: 2, cursor: second.previous });

		expect(first.items.map((user) => user.username)).toEqual(["kebab_c", "kebab_b"]);
		expect(second.items.map((user) => user.username)).toEqual(["kebab_a"]);
		expect(second.total).toBe(3);
		expect(back.items).toEqual(first.items);
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
