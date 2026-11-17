import { describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { defaultMapZoom } from "@src/map/explore";
import { coordinatesSchema } from "@src/settings/actions";
import type { Client } from "@src/db/client";
import type { Database } from "@src/db";
import * as s from "@src/db/schema";
import { exploreHref, restaurantHref } from "@src/hrefs";
import type { Coordinates } from "@src/map/coordinates";
import ExplorePage from "@src/pages/explore.astro";
import { loadSampleCityList } from "@src/tests/cities";
import { renderPage } from "@src/tests/container";
import { createTestDatabase, insertRestaurant, insertUser, signIn } from "@src/tests/database";

const metersPerDegree = 111_320;

// The middle of the map the tests look at, and the address of that map.
const defaultMapCenter: Coordinates = { latitude: 55.3959, longitude: 10.3883 };
const odense = exploreHref({ center: defaultMapCenter, zoom: defaultMapZoom });

// The place the given distances north and east of the middle of the default map.
function near(north: number, east: number): Coordinates {
	const { latitude, longitude } = defaultMapCenter;
	return {
		latitude: latitude + north / metersPerDegree,
		longitude: longitude + east / (metersPerDegree * Math.cos((latitude * Math.PI) / 180)),
	};
}

function insertApproved(client: Client, name: string, place: Coordinates, ratingAvg = 0) {
	const restaurant = insertRestaurant(client, name, { status: "approved", ...place });
	client.update(s.restaurants).set({ ratingAvg }).where(eq(s.restaurants.id, restaurant.id)).run();
	return restaurant;
}

function hrefs(html: string, pattern: RegExp) {
	return [...html.matchAll(pattern)].map((match) => (match[1] ?? "").replaceAll("&amp;", "&"));
}

const markersOf = (html: string) => hrefs(html, /<li class="map-(?:pin|cluster)"[^>]*><a href="([^"]*)"/g);
const rowsOf = (html: string) => hrefs(html, /<a class="list-row-link[^"]*" href="([^"]*)"/g);
// The links over the map that move it, with the cell each covers, counted from 0 at the north-west.

// The cells along the sides of the explore map, row by row from the north-west.


// The map a Visitor sees, on the grid of the explore map.


// The middle of the map, which the link to zoom in keeps.
function mapCenterOf(html: string): Coordinates {
	const [href = ""] = hrefs(html, /<a class="icon-btn" href="([^"]*)"[^>]*title="Zoom in"/g);
	const params = new URL(href, "http://localhost").searchParams;
	return { latitude: Number(params.get("lat")), longitude: Number(params.get("lng")) };
}

const copenhagen = "/explore?lat=55.6761&lng=12.5683&zoom=12";

describe("the explore map", () => {
	it("shows each Cluster as one marker on the map and one row of the list below it, the nearest to the middle first", async () => {
		const { client, db } = createTestDatabase();
		const lone = insertApproved(client, "Lone Kebab", near(200, 0));
		insertApproved(client, "Grill A", near(0, 1000), 6);
		insertApproved(client, "Grill B", near(20, 1010), 9);
		insertApproved(client, "Grill C", near(-15, 990), 4);
		insertRestaurant(client, "Pending Kebab", { ...near(0, 0) });
		insertApproved(client, "Copenhagen Kebab", { latitude: 55.6761, longitude: 12.5683 });

		const { html } = await renderPage(ExplorePage, { db, session: null }, odense);

		expect(markersOf(html)).toEqual(rowsOf(html));
		expect(rowsOf(html)).toHaveLength(2);
		expect(rowsOf(html)[0]).toBe(restaurantHref(lone.id));
		expect(rowsOf(html)[1]).toMatch(/^\/explore\?/);
		// A cluster is named after the best-rated of its restaurants.
		expect(html).toContain("Grill B and 2 more");
		expect(html).not.toContain("Pending Kebab");
		expect(html).not.toContain("Copenhagen Kebab");
	});
});

// Whether the page asks where to look, instead of showing a map.

describe("feeling lucky on the explore page", () => {
	async function parisOf(db: Database, client: Client) {
		await loadSampleCityList(db, insertUser(client, "root_admin", "admin").id);
		const [paris] = await db.cities.search("pari", 1);
		if (!paris) throw new Error("The sample has Paris.");
		return paris;
	}

	async function feelLucky(db: Database, search: string) {
		const { response } = await renderPage(ExplorePage, { db, session: null }, `/explore?${new URLSearchParams({ q: search, lucky: "" })}`);
		return { status: response.status, location: response.headers.get("Location") };
	}

	it("opens the best-rated approved Restaurant of the City, as Google opens its first result", async () => {
		const { client, db } = createTestDatabase();
		const paris = await parisOf(db, client);
		const inParis = (east: number) => ({ latitude: paris.latitude, longitude: paris.longitude + east / 100 });
		insertApproved(client, "Good Kebab", inParis(1), 6);
		const best = insertApproved(client, "Best Kebab", inParis(2), 9);
		const pending = insertRestaurant(client, "Pending Kebab", inParis(0));
		client.update(s.restaurants).set({ ratingAvg: 10 }).where(eq(s.restaurants.id, pending.id)).run();
		insertApproved(client, "Odense Kebab", near(0, 0), 10);

		expect(await feelLucky(db, "pari")).toEqual({ status: 302, location: restaurantHref(best.id) });
	});
});

describe("setting the location from the explore map", () => {
	it("sets the middle of the map as the location of the User, after which the map starts there", async () => {
		const { client, db } = createTestDatabase();
		const ada = insertUser(client, "ada");

		const elsewhere = (await renderPage(ExplorePage, { db, session: await signIn(db, ada.id) }, copenhagen)).html;
		const location = elsewhere.match(/action="\?_action=updateLocation"[\s\S]*?name="location" value="([^"]*)"/)?.[1] ?? "";
		await db.users.setLocation(ada.id, ada.username, coordinatesSchema.parse(location));
		const atHome = (await renderPage(ExplorePage, { db, session: await signIn(db, ada.id) }, "/explore")).html;

		expect(location).toBe("55.676100, 12.568300");
		expect(elsewhere).toContain("Set this as your location");
		expect(elsewhere).not.toContain("Back to your location");
		expect(mapCenterOf(atHome)).toEqual({ latitude: 55.6761, longitude: 12.5683 });
		expect([atHome.includes("Set this as your location"), atHome.includes("Back to your location")]).toEqual([false, false]);
	});
});
