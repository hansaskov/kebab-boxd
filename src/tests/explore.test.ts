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

const defaultMapCenter: Coordinates = { latitude: 55.3959, longitude: 10.3883 };
const odense = exploreHref({ center: defaultMapCenter, zoom: defaultMapZoom });

function near(north: number, east: number): Coordinates {
	const { latitude, longitude } = defaultMapCenter;
	return {
		latitude: latitude + north / metersPerDegree,
		longitude: longitude + east / (metersPerDegree * Math.cos((latitude * Math.PI) / 180)),
	};
}

function insertApproved(client: Client, name: string, place: Coordinates, ratingAvg = 0, reviewCount = 0) {
	const restaurant = insertRestaurant(client, name, { status: "approved", ...place });
	client.update(s.restaurants).set({ ratingAvg, reviewCount }).where(eq(s.restaurants.id, restaurant.id)).run();
	return restaurant;
}

function hrefs(html: string, pattern: RegExp) {
	return [...html.matchAll(pattern)].map((match) => (match[1] ?? "").replaceAll("&amp;", "&"));
}

const markersOf = (html: string) => hrefs(html, /<li class="map-(?:pin|cluster)"[^>]*><a href="([^"]*)"/g);
const rowsOf = (html: string) => hrefs(html, /<a class="list-row-link[^"]*" href="([^"]*)"/g);
const nextPageOf = (html: string) => hrefs(html, /<a class="btn[^"]*" rel="next" href="([^"]*)"/g)[0];

function mapCenterOf(html: string): Coordinates {
	const [href = ""] = hrefs(html, /<a class="icon-btn" href="([^"]*)"[^>]*title="Zoom in"/g);
	const params = new URL(href, "http://localhost").searchParams;
	return { latitude: Number(params.get("lat")), longitude: Number(params.get("lng")) };
}

const copenhagen = "/explore?lat=55.6761&lng=12.5683&zoom=12";

describe("the explore map", () => {
	it("shows each Cluster as one marker on the map, the Restaurants as pins and the rest as counts", async () => {
		const { client, db } = createTestDatabase();
		const lone = insertApproved(client, "Lone Kebab", near(200, 0));
		insertApproved(client, "Grill A", near(0, 1000), 6);
		insertApproved(client, "Grill B", near(20, 1010), 9);
		insertApproved(client, "Grill C", near(-15, 990), 4);

		const { html } = await renderPage(ExplorePage, { db, session: null }, odense);

		expect(markersOf(html)).toHaveLength(2);
		expect(markersOf(html)).toContain(restaurantHref(lone.id));
		expect(html).toContain('title="Grill B and 2 more"');
	});
});

describe("the most reviewed Restaurants on the explore map", () => {
	it("lists the approved Restaurants in view, the most reviewed first, five to a page", async () => {
		const { client, db } = createTestDatabase();
		const reviewCounts = [3, 12, 0, 7, 1, 9, 5];
		const inView = reviewCounts.map((reviewCount, i) => ({ ...insertApproved(client, `Grill ${i}`, near(i * 100, i * 150), 0, reviewCount), reviewCount }));
		const pending = insertRestaurant(client, "Pending Kebab", near(0, 0));
		client.update(s.restaurants).set({ reviewCount: 50 }).where(eq(s.restaurants.id, pending.id)).run();
		insertApproved(client, "Copenhagen Kebab", { latitude: 55.6761, longitude: 12.5683 }, 0, 40);
		const mostReviewedFirst = inView.toSorted((a, b) => b.reviewCount - a.reviewCount).map((restaurant) => restaurantHref(restaurant.id));

		const first = (await renderPage(ExplorePage, { db, session: null }, odense)).html;
		const next = nextPageOf(first);
		const second = (await renderPage(ExplorePage, { db, session: null }, next ?? odense)).html;

		expect(rowsOf(first)).toEqual(mostReviewedFirst.slice(0, 5));
		expect(first).toContain("12 reviews");
		expect(first).not.toContain("Rows per page");
		expect(next).toMatch(/^\/explore\?.*after=/);
		expect(rowsOf(second)).toEqual(mostReviewedFirst.slice(5));
		expect(nextPageOf(second)).toBeUndefined();
		expect(`${first}${second}`).not.toContain("Pending Kebab");
		expect(`${first}${second}`).not.toContain("Copenhagen Kebab");
	});

	it("lists them in the same order in a city with few of the Restaurants of the site as in a view with most of them", async () => {
		const { client, db } = createTestDatabase();
		const inOdense = [2, 0, 5, 1, 3, 4].map((reviewCount, i) => ({ ...insertApproved(client, `Odense Grill ${i}`, near(i * 100, 0), 0, reviewCount), reviewCount }));
		const inCopenhagen = Array.from({ length: 20 }, (_, i) => ({
			...insertApproved(client, `Copenhagen Grill ${i}`, { latitude: 55.6761 + i * 0.001, longitude: 12.5683 }, 0, 10 + i),
			reviewCount: 10 + i,
		}));
		const mostReviewedFirst = (restaurants: { id: number; reviewCount: number }[]) =>
			restaurants.toSorted((a, b) => b.reviewCount - a.reviewCount).map((restaurant) => restaurantHref(restaurant.id));

		const city = (await renderPage(ExplorePage, { db, session: null }, odense)).html;
		const country = (await renderPage(ExplorePage, { db, session: null }, exploreHref({ center: defaultMapCenter, zoom: 6 }))).html;

		expect(rowsOf(city)).toEqual(mostReviewedFirst(inOdense).slice(0, 5));
		expect(rowsOf(country)).toEqual(mostReviewedFirst([...inOdense, ...inCopenhagen]).slice(0, 5));
	});

	it("says so when no Restaurant is in view", async () => {
		const { client, db } = createTestDatabase();
		insertApproved(client, "Copenhagen Kebab", { latitude: 55.6761, longitude: 12.5683 }, 0, 40);

		const { html } = await renderPage(ExplorePage, { db, session: null }, odense);

		expect(rowsOf(html)).toEqual([]);
		expect(html).toContain("There are no restaurants on this part of the map.");
	});
});

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
