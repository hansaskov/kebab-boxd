import { describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { processNextCandidate } from "@src/background-work";
import type { Database } from "@src/db";
import { isProblem } from "@src/db/problem";
import * as s from "@src/db/schema";
import type { Client } from "@src/db/client";
import type { KebabPlace } from "@src/cities/overpass";
import { loadSampleCityList } from "@src/tests/cities";
import { allowed, createTestDatabase, insertRestaurant, insertUser, restaurantRow } from "@src/tests/database";

const odense = { id: 2615876, name: "Odense" };
const copenhagen = { id: 2618425, name: "Copenhagen" };

function kebabPlace(osmId: string, name: string, latitude = 55.396, longitude = 10.388): KebabPlace {
	return { osmId, name, latitude, longitude, address: { addressLine1: "Vestergade 1", postalCode: "5000", city: "Odense", country: "Denmark" } };
}

function found(places: KebabPlace[]) {
	return { places, server: "overpass.example", failures: [] };
}

function logOf(client: Client, id: number) {
	return client.query.citySearchEvents
		.findMany({ columns: { message: true, isError: true }, where: { citySearchId: id }, orderBy: { id: "asc" } })
		.sync()
		.map(({ message, isError }) => (isError ? `! ${message}` : message));
}

async function setUp() {
	const { client, db } = createTestDatabase();
	const admin = insertUser(client, "root_admin", "admin");
	await loadSampleCityList(db, admin.id);
	return { client, db, admin };
}

async function startSearch(db: Database, adminId: number, city = odense) {
	const result = await db.citySearches.start(adminId, city.id, city.name);
	if (isProblem(result)) throw new Error(`The search did not start: ${result.problem}.`);
	return result.id;
}

function searchStatus(client: Client, id: number) {
	return client.query.citySearches.findFirst({ columns: { status: true }, where: { id } }).sync()?.status;
}

async function notificationsOf(db: Database, userId: number) {
	const { page } = await db.notifications.show(userId, { limit: 10, cursor: undefined });
	return page.items.map((notification) =>
		notification.kind === "city-search-finished"
			? `${notification.citySearch.status} ${notification.citySearch.name}: ${notification.citySearch.restaurantCount}`
			: notification.kind,
	);
}

describe("a CitySearch", () => {
	it("is started by an Admin, for a City on the CityList, one at a time for each City", async () => {
		const { client, db, admin } = await setUp();
		const ada = insertUser(client, "ada");

		expect(await db.citySearches.start(ada.id, odense.id, odense.name)).toEqual({ problem: "forbidden", permission: "city-search:start" });
		expect(await db.citySearches.start(admin.id, odense.id, "Aarhus")).toEqual({ problem: "city-not-found" });

		await startSearch(db, admin.id);

		expect(await db.citySearches.start(admin.id, odense.id, odense.name)).toEqual({ problem: "city-search-running" });
		const isSearching = async (city: typeof odense) => allowed(await db.citySearches.findCities(city.name, 20, admin.id)).find((match) => match.id === city.id)?.isSearching;
		expect({ odense: await isSearching(odense), copenhagen: await isSearching(copenhagen) }).toEqual({ odense: true, copenhagen: false });
		expect(await startSearch(db, admin.id, copenhagen)).toEqual(expect.any(Number));
	});

	it("turns the places it finds into approved Restaurants without a suggester, and tells the Admin when the last is added", async () => {
		const { client, db, admin } = await setUp();
		const id = await startSearch(db, admin.id);
		await db.citySearches.saveCandidates(id, found([kebabPlace("node/1", "Kebab Huset"), kebabPlace("way/2", "Döner Corner", 55.4, 10.39)]));

		await processNextCandidate(db);

		expect(searchStatus(client, id)).toBe("adding");
		expect(await notificationsOf(db, admin.id)).toEqual([]);

		await processNextCandidate(db);

		expect(searchStatus(client, id)).toBe("finished");
		expect(await notificationsOf(db, admin.id)).toEqual(["finished Odense: 2"]);
		expect(logOf(client, id)).toEqual(["overpass.example found 2 places, 2 of them new.", "Done. Added 2 restaurants."]);
		const restaurant = client.query.restaurants.findFirst({ with: { location: true }, where: { osmId: "node/1" } }).sync();
		expect(restaurant).toMatchObject({ name: "Kebab Huset", status: "approved", suggestedBy: null, citySearchId: id });
		expect(restaurant?.location).toMatchObject({ addressLine1: "Vestergade 1", city: "Odense", latitude: 55.396 });
	});

	it("leaves out a place that already is a Restaurant, even a rejected one, and teaches one found by its name its OpenStreetMap id", async () => {
		const { client, db, admin } = await setUp();
		const rejected = insertRestaurant(client, "Bad Kebab", { status: "rejected", latitude: 55.5, longitude: 10.5 });
		client.update(s.restaurants).set({ osmId: "node/1" }).where(eq(s.restaurants.id, rejected.id)).run();
		const rejectedByName = insertRestaurant(client, "Gyros King", { status: "rejected", latitude: 55.396, longitude: 10.388 });
		const pending = insertRestaurant(client, "Kebab Huset", { latitude: 55.41, longitude: 10.4 });
		const id = await startSearch(db, admin.id);

		await db.citySearches.saveCandidates(id, found([
			kebabPlace("node/1", "Bad Kebab", 55.5, 10.5),
			kebabPlace("node/2", "GYROS KING", 55.3961, 10.3881),
			kebabPlace("node/3", "KEBAB HUSET", 55.4101, 10.4001),
			kebabPlace("node/4", "Shawarma Palace", 55.42, 10.42),
		]));
		for (let place = 0; place < 3; place++) await processNextCandidate(db);

		expect(client.query.citySearchCandidates.findMany().sync()).toEqual([]);
		expect(client.query.restaurants.findMany({ columns: { name: true }, where: { citySearchId: id } }).sync()).toEqual([{ name: "Shawarma Palace" }]);
		expect([restaurantRow(client, rejectedByName.id)?.osmId, restaurantRow(client, pending.id)?.osmId]).toEqual(["node/2", "node/3"]);
		expect(await notificationsOf(db, admin.id)).toEqual(["finished Odense: 1"]);
	});
});
