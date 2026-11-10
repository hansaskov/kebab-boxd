import { cp, mkdtemp, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-sqlite";
import { migrate } from "drizzle-orm/node-sqlite/migrator";
import { describe, expect, it, onTestFinished } from "vitest";
import { relations } from "@src/db/relations";
import * as s from "@src/db/schema";
import { insertRestaurant, insertUser } from "@src/tests/database";

const migrationsFolder = ".drizzle";

// A database migrated up to, but not including, the migration with the name, and a function that applies the rest.
async function migratedUntil(name: string) {
	const folders = (await readdir(migrationsFolder, { withFileTypes: true }))
		.filter((entry) => entry.isDirectory())
		.map((entry) => entry.name)
		.sort();
	const earlier = folders.filter((folder) => folder < name);
	if (earlier.length === folders.length) throw new Error(`There is no migration named ${name}.`);

	const partial = await mkdtemp(join(tmpdir(), "kebab-boxd-migrations-"));
	onTestFinished(() => rm(partial, { recursive: true, force: true }));
	await Promise.all(earlier.map((folder) => cp(join(migrationsFolder, folder), join(partial, folder), { recursive: true })));

	const client = drizzle(":memory:", { relations });
	migrate(client, { migrationsFolder: partial });
	return { client, migrateRest: () => migrate(client, { migrationsFolder }) };
}

describe("the migration that approves what CitySearches found", () => {
	it("approves the Restaurants a CitySearch entered that wait, and leaves the suggested and decided ones as they are", async () => {
		const { client, migrateRest } = await migratedUntil("20261110212656_approve_city_search_restaurants");
		const admin = insertUser(client, "root_admin", "admin");
		const ada = insertUser(client, "ada");
		const search = client
			.insert(s.citySearches)
			.values({ startedBy: admin.id, cityId: 2615876, name: "Odense", countryCode: "DK", latitude: 55.4, longitude: 10.39, population: 180_000 })
			.returning({ id: s.citySearches.id })
			.get();
		const found = (name: string, status: s.RestaurantStatus) => {
			const restaurant = insertRestaurant(client, name, { status });
			client.update(s.restaurants).set({ citySearchId: search.id }).where(eq(s.restaurants.id, restaurant.id)).run();
		};
		found("Waiting Kebab", "pending");
		found("Rejected Kebab", "rejected");
		insertRestaurant(client, "Suggested Kebab", { suggestedBy: ada.id });

		migrateRest();

		const statuses = client.query.restaurants.findMany({ columns: { name: true, status: true }, orderBy: { id: "asc" } }).sync();
		expect(statuses).toEqual([
			{ name: "Waiting Kebab", status: "approved" },
			{ name: "Rejected Kebab", status: "rejected" },
			{ name: "Suggested Kebab", status: "pending" },
		]);
	});
});
