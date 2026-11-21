import { describe, expect, it } from "vitest";
import { sql } from "drizzle-orm";
import type { Database } from "@src/db";
import type { Client } from "@src/db/client";
import { fewMatchesLimit } from "@src/db/text-search";
import * as s from "@src/db/schema";
import type { PageRequest } from "@src/pagination";
import { allowed, createTestDatabase, insertRestaurant, insertUser } from "@src/tests/database";
import { fillAgain } from "@src/tests/migrations";

const firstPage: PageRequest = { limit: 10, cursor: undefined };

async function restaurantNames(db: Database, search: string) {
	const names: string[] = [];
	let page = firstPage;
	for (;;) {
		const found = await db.restaurants.list(search, "newest", page);
		names.push(...found.items.map((restaurant) => restaurant.name));
		if (!found.next) return names;
		page = { ...firstPage, cursor: found.next };
	}
}

async function personNames(db: Database, search: string) {
	const found = await db.users.search(search, "most-reviews", null, { limit: 50, cursor: undefined });
	return found.items.map((person) => person.username).toSorted();
}

function insertGrills(client: Client, count: number) {
	client.transaction((tx) => {
		for (let i = 0; i < count; i++) {
			const location = tx.insert(s.locations).values({ city: "Aarhus", latitude: 56.15, longitude: 10.2 }).returning({ id: s.locations.id }).get();
			tx.insert(s.restaurants).values({ name: `Grill ${i}`, locationId: location.id, status: "approved" }).run();
		}
	});
}

describe("a search of the Restaurants", () => {
	it("finds the text anywhere in the name or the city, without regard to letter case or accents", async () => {
		const { client, db } = createTestDatabase();
		insertRestaurant(client, "Döner Corner", { status: "approved", city: "Zürich" });
		insertRestaurant(client, "Best Kebab", { status: "approved" });
		insertRestaurant(client, "Kebab Huset", { status: "approved" });
		insertRestaurant(client, "Hidden Kebab");

		expect(await restaurantNames(db, "KEBAB")).toEqual(["Kebab Huset", "Best Kebab"]);
		expect(await restaurantNames(db, "doner")).toEqual(["Döner Corner"]);
		expect(await restaurantNames(db, "zurich")).toEqual(["Döner Corner"]);
		expect(await restaurantNames(db, 'ke"b')).toEqual([]);
	});

	it("finds the names that start with a text of one or two letters", async () => {
		const { client, db } = createTestDatabase();
		insertRestaurant(client, "Best Kebab", { status: "approved" });
		insertRestaurant(client, "Kebab Huset", { status: "approved" });
		insertRestaurant(client, "kebabish", { status: "approved" });

		expect(await restaurantNames(db, "ke")).toEqual(["kebabish", "Kebab Huset"]);
		expect(await restaurantNames(db, "K")).toEqual(["kebabish", "Kebab Huset"]);
		expect(await restaurantNames(db, "b")).toEqual(["Best Kebab"]);
	});

	it("finds the same Restaurants when more than a few match", async () => {
		const { client, db } = createTestDatabase();
		insertGrills(client, fewMatchesLimit + 20);
		insertRestaurant(client, "Grill Pending");

		const all = await restaurantNames(db, "grill");
		const startingWithGr = await restaurantNames(db, "gr");

		expect(all).toHaveLength(fewMatchesLimit + 20);
		expect(all.slice(0, 2)).toEqual([`Grill ${fewMatchesLimit + 19}`, `Grill ${fewMatchesLimit + 18}`]);
		expect(startingWithGr).toEqual(all);
		expect(await restaurantNames(db, `grill ${fewMatchesLimit + 7}`)).toEqual([`Grill ${fewMatchesLimit + 7}`]);
	});
});

describe("a search of the people", () => {
	it("finds the text in the username or the name, and a short text at their start", async () => {
		const { client, db } = createTestDatabase();
		insertUser(client, "kebab_king");
		insertUser(client, "ada");
		client.update(s.users).set({ fullname: "Zoë Kebabsen" }).run();

		expect(await personNames(db, "KING")).toEqual(["kebab_king"]);
		expect(await personNames(db, "zoe")).toEqual(["ada", "kebab_king"]);
		expect(await personNames(db, "ad")).toEqual(["ada"]);
		expect(await personNames(db, "ki")).toEqual([]);
	});

	it("tells an Admin how many users match, until more than a few do", async () => {
		const { client, db } = createTestDatabase();
		const admin = insertUser(client, "root_admin", "admin");
		client.transaction((tx) => {
			for (let i = 0; i < fewMatchesLimit + 1; i++) {
				tx.insert(s.users).values({ fullname: `Someone ${i}`, username: `someone_${i}`, email: `someone_${i}@example.com` }).run();
			}
		});
		const total = async (search: string) => allowed(await db.users.list(search, "all", admin.id, firstPage)).total;

		expect(await total("")).toEqual({ count: fewMatchesLimit + 2, isAtLeast: false });
		expect(await total("someone_1")).toEqual({ count: 1 + 10 + 100, isAtLeast: false });
		expect(await total("someone")).toEqual({ count: fewMatchesLimit, isAtLeast: true });
		expect(await total("example.com")).toEqual({ count: fewMatchesLimit, isAtLeast: true });
	});
});

describe("the search indexes", () => {
	it("are filled by their migration for the Restaurants and people already there", async () => {
		const { client, db } = createTestDatabase();
		insertRestaurant(client, "Döner Corner", { status: "approved", city: "Zürich" });
		insertUser(client, "kebab_king");
		client.run(sql`delete from restaurant_search`);
		client.run(sql`delete from user_search`);

		fillAgain(client, "text_search");

		expect(await restaurantNames(db, "zurich")).toEqual(["Döner Corner"]);
		expect(await personNames(db, "king")).toEqual(["kebab_king"]);
	});
});

