import { describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import type { Client } from "@src/db/client";
import * as s from "@src/db/schema";
import { cellAt, storedCellZooms } from "@src/map/cells";
import { allowed, createTestDatabase, insertRestaurant, insertUser, writeReview } from "@src/tests/database";
import { fillAgain } from "@src/tests/migrations";

const zooms = Array.from({ length: storedCellZooms.finest - storedCellZooms.coarsest + 1 }, (_, i) => storedCellZooms.coarsest + i);

interface Located {
	id: number;
	ratingAvg: number;
	reviewCount: number;
	latitude: number;
	longitude: number;
}

function ranksBefore(a: Located, b: Located) {
	if (a.ratingAvg !== b.ratingAvg) return a.ratingAvg > b.ratingAvg;
	if (a.reviewCount !== b.reviewCount) return a.reviewCount > b.reviewCount;
	return a.id < b.id;
}

function rounded(value: number) {
	return Math.round(value * 1e6) / 1e6;
}

function cellsFromRestaurants(client: Client, zoom: number) {
	const approved = client.query.restaurants
		.findMany({ columns: { id: true, ratingAvg: true, reviewCount: true }, with: { location: { columns: { latitude: true, longitude: true } } }, where: { status: "approved" } })
		.sync()
		.map(({ location, ...restaurant }): Located => ({ ...restaurant, ...location }));
	const cells = Map.groupBy(approved, (restaurant) => {
		const { column, row } = cellAt(restaurant, zoom);
		return `${column}:${row}`;
	});
	return [...cells.values()].map((members) => {
		const [first] = members as [Located, ...Located[]];
		const { column, row } = cellAt(first, zoom);
		const best = members.reduce((a, b) => (ranksBefore(b, a) ? b : a));
		return {
			column,
			row,
			count: members.length,
			latitudeSum: rounded(members.reduce((sum, member) => sum + member.latitude, 0)),
			longitudeSum: rounded(members.reduce((sum, member) => sum + member.longitude, 0)),
			north: Math.max(...members.map((member) => member.latitude)),
			south: Math.min(...members.map((member) => member.latitude)),
			east: Math.max(...members.map((member) => member.longitude)),
			west: Math.min(...members.map((member) => member.longitude)),
			bestId: best.id,
		};
	});
}

function storedCells(client: Client, zoom: number) {
	return client.query.mapCells
		.findMany({ where: { zoom } })
		.sync()
		.map(({ column, row, count, latitudeSum, longitudeSum, north, south, east, west, bestId }) => ({
			column,
			row,
			count,
			latitudeSum: rounded(latitudeSum),
			longitudeSum: rounded(longitudeSum),
			north,
			south,
			east,
			west,
			bestId,
		}));
}

function expectCellsOfRestaurants(client: Client) {
	for (const zoom of zooms) {
		const byPlace = (a: { column: number; row: number }, b: { column: number; row: number }) => a.column - b.column || a.row - b.row;
		expect(storedCells(client, zoom).toSorted(byPlace), `the cells of zoom ${zoom}`).toEqual(cellsFromRestaurants(client, zoom).toSorted(byPlace));
	}
}

describe("the cells of the map", () => {
	it("hold the approved Restaurants as they are entered, approved, rejected, reviewed and moved", async () => {
		const { client, db } = createTestDatabase();
		const admin = insertUser(client, "root_admin", "admin");
		const ada = insertUser(client, "ada");
		const bob = insertUser(client, "bob");
		const odense = [3, 0, 5, 1, 4, 2].map((offset, i) =>
			insertRestaurant(client, `Odense Kebab ${i}`, { status: "approved", latitude: 55.39 + offset * 0.002, longitude: 10.38 + (5 - offset) * 0.003 }),
		);
		const [twin, otherTwin] = [0, 1].map((i) =>
			insertRestaurant(client, `Twin Kebab ${i}`, { status: "approved", latitude: 55.4001 + i * 0.0001, longitude: 10.3901 }),
		);
		const pending = insertRestaurant(client, "Pending Kebab", { latitude: 55.395, longitude: 10.385 });
		insertRestaurant(client, "Aarhus Kebab", { status: "approved", latitude: 56.15, longitude: 10.2 });
		insertRestaurant(client, "Paris Kebab", { status: "approved", latitude: 48.85, longitude: 2.35 });
		expectCellsOfRestaurants(client);

		await db.restaurants.decide(admin.id, [pending.id], "approved");
		expectCellsOfRestaurants(client);

		await db.restaurants.decide(admin.id, [odense[0]!.id, odense[3]!.id], "rejected");
		expectCellsOfRestaurants(client);

		await writeReview(db, ada.id, twin!.id, 6);
		await writeReview(db, bob.id, otherTwin!.id, 6);
		await writeReview(db, ada.id, odense[2]!.id, 8);
		expectCellsOfRestaurants(client);

		await writeReview(db, ada.id, otherTwin!.id, 6);
		expectCellsOfRestaurants(client);

		await db.restaurants.decide(admin.id, [otherTwin!.id], "rejected");
		await db.restaurants.decide(admin.id, [otherTwin!.id], "approved");
		expectCellsOfRestaurants(client);

		allowed(await db.users.ban(admin.id, "ada"));
		expectCellsOfRestaurants(client);

		const { locationId } = odense[4]!;
		client.update(s.locations).set({ latitude: 48.86, longitude: 2.34 }).where(eq(s.locations.id, locationId)).run();
		expectCellsOfRestaurants(client);
		expect(client.query.mapCells.findMany({ where: { zoom: storedCellZooms.coarsest } }).sync().length).toBeGreaterThan(1);
	});

	it("are filled by their migration for the approved Restaurants already there", async () => {
		const { client, db } = createTestDatabase();
		const ada = insertUser(client, "ada");
		const restaurants = [3, 0, 5, 1, 4, 2].map((offset, i) =>
			insertRestaurant(client, `Kebab ${i}`, { status: i === 4 ? "rejected" : "approved", latitude: 55.39 + offset * 0.002, longitude: 10.38 + offset * 0.05 }),
		);
		await writeReview(db, ada.id, restaurants[2]!.id, 8);
		client.delete(s.mapCells).run();

		fillAgain(client, "map_cells");

		expectCellsOfRestaurants(client);
		expect(client.$count(s.mapCells).sync()).toBeGreaterThan(0);
	});
});
