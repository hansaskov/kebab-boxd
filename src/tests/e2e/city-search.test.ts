import { describe, expect, it } from "vitest";
import { processDueWork } from "@src/background-work";
import type { Database } from "@src/db";
import { isProblem } from "@src/db/problem";
import { findKebabPlaces, overpassServers, serverName } from "@src/map/overpass";
import { createTestDatabase, insertUser } from "@src/tests/database";

// These tests ask the real services, the way the Durable Object does, but from this machine: a server that
// refuses Cloudflare may still answer here.

const odense = { latitude: 55.39594, longitude: 10.38831, population: 180863, countryCode: "DK" };

// Works through the background work as the alarms of the Durable Object do, until nothing is left to do.
async function runUntilIdle(db: Database, deadline: number) {
	for (;;) {
		const dueAt = await processDueWork(db);
		if (!dueAt || Date.now() > deadline) return;
		await new Promise((resolve) => setTimeout(resolve, Math.max(0, dueAt.getTime() - Date.now())));
	}
}

describe("end to end", () => {
	it("downloads the CityList from GeoNames, and finds a City in it", async () => {
		const { client, db } = createTestDatabase();
		const admin = insertUser(client, "root_admin", "admin");
		await db.cities.requestUpdate(admin.id);

		await runUntilIdle(db, Date.now() + 120_000);

		expect((await db.cities.status()).current?.cityCount).toBeGreaterThan(150_000);
		expect((await db.cities.search("odense", 1))[0]).toMatchObject({ name: "Odense", countryCode: "DK" });
		expect((await db.cities.search("zurich", 1))[0]).toMatchObject({ name: "Zürich", countryCode: "CH" });
	}, 180_000);

	// Public servers come and go, so the search asks them in turn. The places come from the first that answers,
	// and the log tells why the ones before it did not.
	it("asks the Overpass servers in turn for the kebab places of a City, until one answers", async () => {
		const { places, server, failures } = await findKebabPlaces(odense);

		expect(overpassServers.map(serverName)).toContain(server);
		expect(failures.map((failure) => failure.server)).toEqual(overpassServers.map(serverName).slice(0, failures.length));
		expect(places.length).toBeGreaterThan(10);
	}, 300_000);

	it("finds the kebab restaurants of Odense, from the start of a CitySearch to the notification at its end", async () => {
		const { client, db } = createTestDatabase();
		const admin = insertUser(client, "root_admin", "admin");
		await db.cities.requestUpdate(admin.id);
		await runUntilIdle(db, Date.now() + 120_000);
		const [city] = await db.cities.search("odense", 1);
		const started = await db.citySearches.start(admin.id, city!.id, city!.name);
		if (isProblem(started)) throw new Error(`The search did not start: ${started.problem}.`);

		await runUntilIdle(db, Date.now() + 240_000);

		const search = await db.citySearches.findById(started.id);
		const restaurants = client.query.restaurants.findMany({ with: { location: true }, where: { citySearchId: started.id } }).sync();
		const { page } = await db.notifications.show(admin.id, { limit: 10, cursor: undefined });
		expect(search).toMatchObject({ status: "finished", candidateCount: 0 });
		expect(restaurants.length).toBeGreaterThan(10);
		expect(restaurants.every((restaurant) => restaurant.status === "pending" && restaurant.osmId && restaurant.suggestedBy === null)).toBe(true);
		expect(restaurants.filter((restaurant) => restaurant.location.addressLine1 && restaurant.location.city).length).toBeGreaterThan(restaurants.length / 2);
		expect(search?.events.at(-1)?.message).toMatch(/found \d+ places/);
		expect(search?.events[0]?.message).toBe(`Done. Added ${restaurants.length} restaurants.`);
		expect(page.items.map((notification) => notification.kind)).toEqual(["city-search-finished"]);
	}, 420_000);
});
