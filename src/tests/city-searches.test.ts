import { describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { processNextCandidate, processNextWork } from "@src/background-work";
import type { Database } from "@src/db";
import { maxAttempts } from "@src/db/city-searches";
import { isProblem } from "@src/db/problem";
import * as s from "@src/db/schema";
import type { Client } from "@src/db/client";
import { findKebabPlaces, kebabQuery, OverpassUnavailableError, readKebabPlaces, searchRadiusMeters, type KebabPlace } from "@src/map/overpass";
import { loadSampleCityList } from "@src/tests/cities";
import { createTestDatabase, insertRestaurant, insertUser, restaurantRow } from "@src/tests/database";

// GeoNames ids of cities in the sample CityList.
const odense = { id: 2615876, name: "Odense" };
const copenhagen = { id: 2618425, name: "Copenhagen" };

// A place with a street and a city, which is added without asking Nominatim.
function kebabPlace(osmId: string, name: string, latitude = 55.396, longitude = 10.388): KebabPlace {
	return { osmId, name, latitude, longitude, address: { addressLine1: "Vestergade 1", postalCode: "5000", city: "Odense", country: "Denmark" } };
}

// What a server found, as Overpass gives it.
function found(places: KebabPlace[]) {
	return { places, server: "overpass.example", failures: [] };
}

const unreachable = [{ server: "overpass-api.de", reason: "answered 521" }];

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
		expect(await db.citySearches.listRunningCityIds([odense.id, copenhagen.id])).toEqual([odense.id]);
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

	it("leaves only the Restaurants that Users suggest waiting for an Admin, who may still reject one it found", async () => {
		const { client, db, admin } = await setUp();
		const ada = insertUser(client, "ada");
		const queued = await db.suggestionQueue.queue(ada.id, "https://www.google.com/maps/place/Shawarma+Village/data=!1s0x1:0x2!3d55.39!4d10.37");
		if (isProblem(queued)) throw new Error(`The link was not queued: ${queued.problem}.`);
		const suggested = await db.suggestionQueue.finish(
			queued.id,
			{ name: "Shawarma Village", googleMapsId: "0x1:0x2", latitude: 55.39, longitude: 10.37 },
			{ addressLine1: "Kongensgade 13", postalCode: "5000", city: "Odense", country: "Denmark" },
		);
		const id = await startSearch(db, admin.id);
		await db.citySearches.saveCandidates(id, found([kebabPlace("node/1", "Kebab Huset")]));
		await processNextCandidate(db);
		const listed = async (status: "pending" | "approved") =>
			(await db.restaurants.listByStatus(status, { limit: 10, cursor: undefined })).items.map((restaurant) => restaurant.name);

		expect(suggested.status).toBe("suggested");
		expect([await listed("pending"), await listed("approved")]).toEqual([["Shawarma Village"], ["Kebab Huset"]]);
		expect((await db.restaurants.list("", "newest", { limit: 10, cursor: undefined })).items.map((restaurant) => restaurant.name)).toEqual(["Kebab Huset"]);

		const kebabHuset = client.query.restaurants.findFirst({ columns: { id: true }, where: { citySearchId: id } }).sync()!;
		expect(await db.restaurants.decide(admin.id, [kebabHuset.id], "rejected")).toEqual({ decided: 1 });
		expect(await db.restaurants.countByStatus(id)).toEqual({ approved: 0, pending: 0, rejected: 1 });
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

	it("keeps hundreds of places at once, within the limits of SQLite in a Durable Object", async () => {
		const { client, db, admin } = await setUp();
		const id = await startSearch(db, admin.id);
		const places = Array.from({ length: 250 }, (_, index) => kebabPlace(`node/${index + 1}`, `Kebab ${index + 1}`, 55 + index / 1000, 10));

		await db.citySearches.saveCandidates(id, found(places));

		expect(searchStatus(client, id)).toBe("adding");
		expect(client.$count(s.citySearchCandidates).sync()).toBe(250);
	});

	it("ends at once when OpenStreetMap finds nothing new", async () => {
		const { client, db, admin } = await setUp();
		const id = await startSearch(db, admin.id);

		await db.citySearches.saveCandidates(id, found([]));

		expect(searchStatus(client, id)).toBe("finished");
		expect(await notificationsOf(db, admin.id)).toEqual(["finished Odense: 0"]);
	});

	it("is tried again later while Overpass cannot be reached, and fails after the last attempt", async () => {
		const { client, db, admin } = await setUp();
		const id = await startSearch(db, admin.id);
		const now = new Date();

		await db.citySearches.retrySearchLater(id, now, unreachable);

		expect(await db.citySearches.nextSearch()).toMatchObject({ id, runAfter: expect.any(Date) });
		expect((await db.citySearches.nextSearch())!.runAfter > now).toBe(true);

		for (let attempt = 2; attempt <= maxAttempts; attempt++) await db.citySearches.retrySearchLater(id, now, unreachable);

		expect(searchStatus(client, id)).toBe("failed");
		expect(await db.citySearches.nextSearch()).toBeUndefined();
		expect(await notificationsOf(db, admin.id)).toEqual(["failed Odense: 0"]);
		expect(logOf(client, id).slice(0, 4)).toEqual(["! overpass-api.de answered 521.", "Trying again in 2 minutes.", "! overpass-api.de answered 521.", "Trying again in 4 minutes."]);
		expect(logOf(client, id).at(-1)).toBe(`! Gave up after ${maxAttempts} attempts.`);
	});

	it("is tried again now when an Admin asks, after it failed or while it waits, and tells the Admin again when it ends", async () => {
		const { client, db, admin } = await setUp();
		const ada = insertUser(client, "ada");
		const id = await startSearch(db, admin.id);
		for (let attempt = 1; attempt <= maxAttempts; attempt++) await db.citySearches.retrySearchLater(id, new Date(), unreachable);
		await notificationsOf(db, admin.id);

		expect(await db.citySearches.retry(ada.id, id)).toEqual({ problem: "forbidden", permission: "city-search:start" });
		expect(await db.citySearches.retry(admin.id, id)).toEqual({ id });
		expect(await db.citySearches.nextSearch()).toMatchObject({ id });
		expect(client.query.citySearches.findFirst({ columns: { status: true, attempts: true }, where: { id } }).sync()).toEqual({ status: "queued", attempts: 0 });
		expect(logOf(client, id).at(-1)).toBe("An admin asked to try again now.");

		await db.citySearches.retrySearchLater(id, new Date(), unreachable);
		await db.citySearches.retry(admin.id, id);

		expect((await db.citySearches.nextSearch())!.runAfter <= new Date()).toBe(true);

		await db.citySearches.saveCandidates(id, found([]));

		expect(await notificationsOf(db, admin.id)).toEqual(["finished Odense: 0"]);
		expect(await db.citySearches.retry(admin.id, id)).toEqual({ problem: "city-search-finished" });
	});

	it("logs a place it could not look up, and adds it with what OpenStreetMap knows after the last attempt", async () => {
		const { client, db, admin } = await setUp();
		const id = await startSearch(db, admin.id);
		await db.citySearches.saveCandidates(id, found([kebabPlace("node/1", "Kebab Huset")]));
		const candidate = (await db.citySearches.nextCandidate())!;

		await db.citySearches.retryCandidateLater(candidate.id, new Date(), "Nominatim answered 503");
		await db.citySearches.addCandidate(candidate.id, { addressLine1: null, postalCode: null, city: "Odense", country: "Denmark" }, { withoutLookup: true });

		expect(logOf(client, id)).toEqual([
			"overpass.example found 1 place, 1 of them new.",
			"! Could not look up the address of Kebab Huset: Nominatim answered 503. Trying again in 1 minute.",
			"! Added Kebab Huset with the address OpenStreetMap gave, which may lack the street.",
			"Done. Added 1 restaurant.",
		]);
	});

	it("waits while a User's link is looked up first", async () => {
		const { client, db, admin } = await setUp();
		const ada = insertUser(client, "ada");
		// A link to a place whose name is not valid percent-encoding, so it is never looked up.
		await db.suggestionQueue.queue(ada.id, "https://www.google.com/maps/place/Kebab%E0%A4/data=!1s0x1:0x2!3d55!4d10");
		const id = await startSearch(db, admin.id);
		await db.citySearches.saveCandidates(id, found([kebabPlace("node/1", "Kebab Huset")]));

		await processNextWork(db);

		expect(client.query.suggestionQueue.findFirst({ columns: { status: true } }).sync()).toEqual({ status: "not-a-place" });
		expect(searchStatus(client, id)).toBe("adding");

		await processNextWork(db);

		expect(searchStatus(client, id)).toBe("finished");
	});
});

describe("OpenStreetMap", () => {
	it("is asked at each server in turn, and tells why each one failed when none answers", async () => {
		// Nothing listens on port 9 of this machine, so the connection is refused at once.
		const servers = ["http://127.0.0.1:9/api/interpreter", "http://localhost:9/api/interpreter"];

		const failure = await findKebabPlaces({ latitude: 55.4, longitude: 10.39, population: 1000, countryCode: "DK" }, servers).catch((error: unknown) => error);

		expect(failure).toBeInstanceOf(OverpassUnavailableError);
		expect((failure as OverpassUnavailableError).failures.map((f) => f.server)).toEqual(["127.0.0.1", "localhost"]);
	});

	it("is searched in a circle that grows with the population of the City", () => {
		expect([1_000, 180_000, 600_000, 3_500_000, 30_000_000].map(searchRadiusMeters)).toEqual([2_000, 5_743, 9_246, 20_208, 30_000]);
		expect(kebabQuery({ latitude: 55.4, longitude: 10.39 }, 5_743)).toContain("(around:5743,55.4,10.39)");
	});

	it("gives the named places it found, with what it knows of their address", () => {
		const places = readKebabPlaces(
			{
				elements: [
					{
						type: "node",
						id: 1,
						lat: 55.39,
						lon: 10.38,
						tags: { name: "Kebab Huset", "addr:street": "Vestergade", "addr:housenumber": "12", "addr:postcode": "5000", "addr:city": "Odense" },
					},
					{ type: "way", id: 2, center: { lat: 55.4, lon: 10.4 }, tags: { name: "Malmö Kebab", "addr:country": "SE" } },
					{ type: "node", id: 3, lat: 55.41, lon: 10.41, tags: { cuisine: "kebab" } },
				],
			},
			"DK",
		);

		expect(places).toEqual([
			{
				osmId: "node/1",
				name: "Kebab Huset",
				latitude: 55.39,
				longitude: 10.38,
				address: { addressLine1: "Vestergade 12", postalCode: "5000", city: "Odense", country: "Denmark" },
			},
			{
				osmId: "way/2",
				name: "Malmö Kebab",
				latitude: 55.4,
				longitude: 10.4,
				address: { addressLine1: null, postalCode: null, city: null, country: "Sweden" },
			},
		]);
	});
});

describe("several Restaurants", () => {
	it("are approved at once by an Admin, who tells each suggester, and by nobody else", async () => {
		const { client, db, admin } = await setUp();
		const ada = insertUser(client, "ada");
		const first = insertRestaurant(client, "Kebab One", { suggestedBy: ada.id });
		const second = insertRestaurant(client, "Kebab Two", { suggestedBy: ada.id });

		expect(await db.restaurants.decide(ada.id, [first.id, second.id], "approved")).toEqual({ problem: "forbidden", permission: "restaurant:moderate" });
		expect(await db.restaurants.decide(admin.id, [first.id, second.id + 1], "approved")).toEqual({ problem: "not-found", permission: "restaurant:moderate" });
		expect(restaurantRow(client, first.id)?.status).toBe("pending");

		expect(await db.restaurants.decide(admin.id, [first.id, second.id, first.id], "approved")).toEqual({ decided: 2 });
		expect([restaurantRow(client, first.id)?.status, restaurantRow(client, second.id)?.status]).toEqual(["approved", "approved"]);
		expect(await notificationsOf(db, ada.id)).toEqual(["suggestion-approved", "suggestion-approved"]);
	});
});
