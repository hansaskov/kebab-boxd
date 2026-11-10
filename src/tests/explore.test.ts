import { describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { clusterCellSize, clusterMargin, defaultMapZoom, exploreGridStep, exploreMapCells, exploreMapSize } from "@src/data/map";
import type { Client } from "@src/db/client";
import type { Database } from "@src/db";
import * as s from "@src/db/schema";
import { exploreCityHref, exploreHref, restaurantHref } from "@src/hrefs";
import { clustersOn, openedView } from "@src/map/clusters";
import type { Coordinates } from "@src/map/coordinates";
import { maxZoom, snapToGrid, viewport, type MapView } from "@src/map/viewport";
import ExplorePage from "@src/pages/explore.astro";
import { loadSampleCityList } from "@src/tests/cities";
import { dialogIn, renderPage } from "@src/tests/container";
import { createTestDatabase, insertRestaurant, insertUser, signIn } from "@src/tests/database";
import { coordinatesSchema } from "@src/validation/coordinates";

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
const cellsOf = (html: string) =>
	[...html.matchAll(/<a class="map-cell" href="([^"]*)"[^>]*><span class="sr-only">([^<]*)<\/span>/g)].map(([, href = "", label = ""]) => ({
		params: new URL(href.replaceAll("&amp;", "&"), "http://localhost").searchParams,
		label,
	}));

const defaultMap = () => viewport(defaultMapCenter, defaultMapZoom, exploreMapSize);

// The map a Visitor sees, on the grid of the explore map.
function visitorMap(view: MapView) {
	const snapped = snapToGrid(view, exploreGridStep);
	return viewport(snapped.center, snapped.zoom, exploreMapSize);
}

const mapLinksOf = (html: string) => hrefs(html, /href="(\/explore\?lat=[^"]*)"/g).map((href) => href.replaceAll("&amp;", "&"));

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

	it("opens a Cluster by zooming in until all of its restaurants are on the map", async () => {
		const { client, db } = createTestDatabase();
		const places = [near(0, 0), near(60, 80), near(-40, -90)];
		for (const [index, place] of places.entries()) insertApproved(client, `Kebab ${index}`, place);
		const map = defaultMap();

		const [cluster, ...others] = await clustersOn(map, db.restaurants.listClusters);
		if (!cluster) throw new Error("The restaurants are not on the map.");
		const opened = openedView(cluster, map);
		const openedMap = viewport(opened.center, opened.zoom, exploreMapSize);
		const placements = places.map((place) => openedMap.place(place));
		const margin = { left: (clusterMargin / exploreMapSize.width) * 100, top: (clusterMargin / exploreMapSize.height) * 100 };

		expect([cluster.count, others.length]).toEqual([3, 0]);
		expect(opened.zoom).toBeGreaterThan(map.zoom + 1);
		for (const { left, top } of placements) {
			expect(left).toBeGreaterThanOrEqual(margin.left - 0.01);
			expect(left).toBeLessThanOrEqual(100 - margin.left + 0.01);
			expect(top).toBeGreaterThanOrEqual(margin.top - 0.01);
			expect(top).toBeLessThanOrEqual(100 - margin.top + 0.01);
		}
	});

	it("keeps each Cluster the same while the map moves and its restaurants stay in view", async () => {
		const { client, db } = createTestDatabase();
		// The map is centered on a corner of the grid, with three restaurants in each of the four cells around it. They
		// are close enough to the corner to stay in view after each move, and far enough apart to stay four clusters.
		const grid = defaultMap().clusterGrid(clusterCellSize);
		const longitudePerPixel = 1 / (grid.columnsPerDegree * clusterCellSize);
		const latitudePerPixel = longitudePerPixel * Math.cos((defaultMapCenter.latitude * Math.PI) / 180);
		const nearest = (values: number[], to: number) => values.reduce((best, value) => (Math.abs(value - to) < Math.abs(best - to) ? value : best));
		const corner = {
			latitude: nearest(grid.rowEdges, defaultMapCenter.latitude),
			longitude: Math.round((defaultMapCenter.longitude + 180) * grid.columnsPerDegree) / grid.columnsPerDegree - 180,
		};
		for (const north of [-40, 40]) {
			for (const east of [-40, 40]) {
				for (const step of [0, 6, 12]) {
					const place = { latitude: corner.latitude + (north + step) * latitudePerPixel, longitude: corner.longitude + (east + step) * longitudePerPixel };
					insertApproved(client, `Kebab ${north} ${east} ${step}`, place, step);
				}
			}
		}
		const clustersAround = async (center: Coordinates) =>
			(await clustersOn(viewport(center, defaultMapZoom, exploreMapSize), db.restaurants.listClusters))
				.map((cluster) => `${cluster.best.name}: ${cluster.count}`)
				.toSorted();

		const before = await clustersAround(corner);
		const map = viewport(corner, defaultMapZoom, exploreMapSize);
		const afterEachMove = await Promise.all(map.cellCenters(exploreMapCells.columns, exploreMapCells.rows).map(clustersAround));

		expect(before).toEqual(["Kebab -40 -40 12: 3", "Kebab -40 40 12: 3", "Kebab 40 -40 12: 3", "Kebab 40 40 12: 3"]);
		for (const after of afterEachMove) expect(after).toEqual(before);
	});

	it("shows each restaurant on its own at the largest zoom, where a Cluster could not be opened", async () => {
		const { client, db } = createTestDatabase();
		insertApproved(client, "Food Court Kebab", near(0, 0));
		insertApproved(client, "Food Court Grill", near(3, 3));
		const countsAt = async (zoom: number) =>
			(await clustersOn(viewport(defaultMapCenter, zoom, exploreMapSize), db.restaurants.listClusters)).map((cluster) => cluster.count);

		expect({ largest: await countsAt(maxZoom), closer: await countsAt(maxZoom - 1) }).toEqual({ largest: [1, 1], closer: [2] });
	});

	it("joins the Clusters on either side of the edge of a cell, so that their markers do not cover each other", async () => {
		const { client, db } = createTestDatabase();
		const map = defaultMap();
		const [edge] = map.clusterGrid(clusterCellSize).rowEdges;
		if (edge === undefined) throw new Error("The map has a single row of cells.");
		insertApproved(client, "North Kebab", { latitude: edge + 0.0001, longitude: defaultMapCenter.longitude });
		insertApproved(client, "South Kebab", { latitude: edge - 0.0001, longitude: defaultMapCenter.longitude });

		const clusters = await clustersOn(map, db.restaurants.listClusters);

		expect(clusters.map((cluster) => cluster.count)).toEqual([2]);
	});

	it("moves to the middle of the cell the user clicks, which tells how far and which way", async () => {
		const { db } = createTestDatabase();
		const map = visitorMap({ center: defaultMapCenter, zoom: defaultMapZoom });

		const cells = cellsOf((await renderPage(ExplorePage, { db, session: null }, odense)).html);
		const placements = cells.map(({ params }) => map.place({ latitude: Number(params.get("lat")), longitude: Number(params.get("lng")) }));

		expect(cells).toHaveLength(exploreMapCells.columns * exploreMapCells.rows);
		expect(cells.every(({ params }) => params.get("zoom") === String(map.zoom))).toBe(true);
		for (const [index, { left, top }] of placements.entries()) {
			const column = index % exploreMapCells.columns;
			const row = Math.floor(index / exploreMapCells.columns);
			expect(left).toBeCloseTo(((column + 0.5) / exploreMapCells.columns) * 100, 1);
			expect(top).toBeCloseTo(((row + 0.5) / exploreMapCells.rows) * 100, 1);
		}
		expect(new Set(cells.map(({ label }) => label)).size).toBe(cells.length);
		expect(cells[0]?.label).toMatch(/^Move [\d.]+ k?m north and [\d.]+ k?m west$/);
		expect(cells.at(-1)?.label).toMatch(/^Move [\d.]+ k?m south and [\d.]+ k?m east$/);
	});

	it("keeps the map of a Visitor on a grid, so that every way to a place leads to the same address", async () => {
		const { client, db } = createTestDatabase();
		insertApproved(client, "Grill A", near(0, 1000));
		insertApproved(client, "Grill B", near(20, 1010));
		// Off the grid, as a link a User shared may be.
		const shared = { center: { latitude: 55.40123, longitude: 10.39876 }, zoom: 13 };
		const here = exploreHref({ center: visitorMap(shared).center, zoom: shared.zoom });
		const visit = async (path: string) => (await renderPage(ExplorePage, { db, session: null }, path)).html;
		const zoomLink = (html: string, title: "Zoom in" | "Zoom out") =>
			hrefs(html, new RegExp(`<a class="icon-btn" href="([^"]*)"[^>]*title="${title}"`, "g"))[0]!.replaceAll("&amp;", "&");
		// The links of the map come in order: the cluster on it, the two zooms, the cells and the cluster in the list.
		const firstCell = 3;
		const cellLink = (html: string, row: number, column: number) => mapLinksOf(html)[firstCell + row * exploreMapCells.columns + column]!;
		const onGrid = (href: string) => {
			const params = new URL(href, "http://localhost").searchParams;
			const center = { latitude: Number(params.get("lat")), longitude: Number(params.get("lng")) };
			return exploreHref(snapToGrid({ center, zoom: Number(params.get("zoom")) }, exploreGridStep));
		};

		const page = await visit(exploreHref(shared));
		const links = mapLinksOf(page);

		// The cluster on the map and in the list, the two zooms and the cells.
		expect(links).toHaveLength(2 + 2 + exploreMapCells.columns * exploreMapCells.rows);
		for (const link of links) expect(link).toBe(onGrid(link));
		expect(zoomLink(await visit(zoomLink(page, "Zoom in")), "Zoom out")).toBe(here);
		// Half a cell north-west, and back south-east.
		expect(cellLink(await visit(cellLink(page, 1, 2)), 2, 3)).toBe(here);
	});

	it("has the browser load a page of the map in advance only when the user is about to open it", async () => {
		const { client, db } = createTestDatabase();
		insertApproved(client, "Lone Kebab", near(200, 0));
		insertApproved(client, "Grill A", near(0, 1000));
		insertApproved(client, "Grill B", near(20, 1010));

		const { html } = await renderPage(ExplorePage, { db, session: null }, odense);
		const map = html.slice(html.indexOf('<div class="map'), html.indexOf('<p class="map-attribution'));
		const links = map.match(/<a [^>]*>/g) ?? [];
		const rules = JSON.parse(html.match(/<script type="speculationrules">([^<]*)<\/script>/)?.[1] ?? "{}");
		const onIntent = { selector_matches: '[data-eagerness="moderate"]' };

		expect(links.length).toBeGreaterThan(exploreMapCells.columns * exploreMapCells.rows);
		expect(links.filter((link) => !link.includes('data-eagerness="moderate"'))).toEqual([]);
		expect(rules.prerender).toEqual([
			{ where: { and: expect.arrayContaining([{ not: onIntent }]) }, eagerness: "eager" },
			{ where: { and: expect.arrayContaining([onIntent]) }, eagerness: "moderate" },
		]);
		// A row of the list that zooms in on a cluster moves the map too, and a row that opens a restaurant does not.
		const rows = html.match(/<a class="list-row-link[^>]*>/g) ?? [];
		expect(rows.map((row) => ({ zooms: row.includes('href="/explore?'), onIntent: row.includes('data-eagerness="moderate"') }))).toEqual([
			{ zooms: false, onIntent: false },
			{ zooms: true, onIntent: true },
		]);
	});
});

// Whether the page asks where to look, instead of showing a map.
const asksWhereOf = (html: string) => html.includes('placeholder="Where do you want reviews from?"') && !html.includes('<div class="map');

describe("the start of the explore page", () => {
	it("asks a Visitor and a User without a location where they want reviews from, and offers to feel lucky", async () => {
		const { client, db } = createTestDatabase();
		const ada = insertUser(client, "ada");
		insertApproved(client, "Lone Kebab", near(0, 0));

		const visitor = (await renderPage(ExplorePage, { db, session: null }, "/explore")).html;
		const user = (await renderPage(ExplorePage, { db, session: await signIn(db, ada.id) }, "/explore")).html;

		for (const html of [visitor, user]) {
			expect(asksWhereOf(html)).toBe(true);
			expect(html).toContain('<button class="btn btn-secondary btn-md" type="submit" name="lucky" value="">I’m feeling lucky</button>');
			expect(html).not.toContain("Lone Kebab");
		}
	});

	it("shows a User the map around their location at once", async () => {
		const { client, db } = createTestDatabase();
		const ada = insertUser(client, "ada");
		await db.users.setLocation(ada.id, ada.username, defaultMapCenter);
		insertApproved(client, "Lone Kebab", near(200, 0));

		const { html } = await renderPage(ExplorePage, { db, session: await signIn(db, ada.id) }, "/explore");

		expect(asksWhereOf(html)).toBe(false);
		expect(html).toContain("Lone Kebab");
	});

	it("keeps asking when no City starts with the search, and says so", async () => {
		const { client, db } = createTestDatabase();
		await loadSampleCityList(db, insertUser(client, "root_admin", "admin").id);

		const search = (await renderPage(ExplorePage, { db, session: null }, "/explore?q=odensee")).html;
		const lucky = (await renderPage(ExplorePage, { db, session: null }, "/explore?q=odensee&lucky=")).html;

		for (const html of [search, lucky]) {
			expect(asksWhereOf(html)).toBe(true);
			expect(html).toContain('value="odensee"');
			expect(html).toContain("No city starts with “odensee”.");
		}
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

	it("shows the map of the City when it has no approved Restaurant", async () => {
		const { client, db } = createTestDatabase();
		const paris = await parisOf(db, client);
		insertApproved(client, "Odense Kebab", near(0, 0), 10);

		expect(await feelLucky(db, "pari")).toEqual({ status: 302, location: exploreCityHref("pari", paris.id) });
	});

	it("opens an approved Restaurant without a search, and says when there is none", async () => {
		const { client, db } = createTestDatabase();
		const before = (await renderPage(ExplorePage, { db, session: null }, "/explore?lucky=")).html;
		insertRestaurant(client, "Pending Kebab", near(0, 0));
		const approved = insertApproved(client, "Lone Kebab", near(200, 0));

		expect(asksWhereOf(before)).toBe(true);
		expect(before).toContain("There are no restaurants yet.");
		expect(await feelLucky(db, "")).toEqual({ status: 302, location: restaurantHref(approved.id) });
	});

	it("picks any approved Restaurant by a fraction, and never one that is not approved", async () => {
		const { client, db } = createTestDatabase();
		const first = insertApproved(client, "First Kebab", near(0, 0));
		insertRestaurant(client, "Pending Kebab", near(0, 0));
		insertRestaurant(client, "Rejected Kebab", { ...near(0, 0), status: "rejected" });
		const middle = insertApproved(client, "Middle Kebab", near(0, 0));
		const last = insertApproved(client, "Last Kebab", near(0, 0));

		const picked = await Promise.all([-1, 0, 0.2, 0.4, 0.6, 0.8, 0.99, 1].map(async (fraction) => (await db.restaurants.pickApproved(fraction))?.id));

		expect(picked).toEqual([first.id, first.id, middle.id, middle.id, middle.id, last.id, last.id, last.id]);
	});
});

describe("a search on the explore map", () => {
	it("moves the map to the most populous City whose name starts with it, and offers the others of the name", async () => {
		const { client, db } = createTestDatabase();
		await loadSampleCityList(db, insertUser(client, "root_admin", "admin").id);
		const [france, texas] = await db.cities.search("pari", 5);
		if (!france || !texas) throw new Error("The sample has two cities called Paris.");
		const visit = async (path: string) => (await renderPage(ExplorePage, { db, session: null }, path)).html;

		const first = await visit("/explore?q=pari");
		const chosen = await visit(exploreCityHref("pari", texas.id));

		expect(mapCenterOf(first).latitude).toBeCloseTo(france.latitude, 1);
		expect(mapCenterOf(first).longitude).toBeCloseTo(france.longitude, 1);
		expect(first).toMatch(/aria-current="page"[^>]*>Paris, Île-de-France, France</);
		expect(first).toContain(`href="${exploreCityHref("pari", texas.id).replaceAll("&", "&amp;")}"`);
		expect(mapCenterOf(chosen).latitude).toBeCloseTo(texas.latitude, 1);
		expect(mapCenterOf(chosen).longitude).toBeCloseTo(texas.longitude, 1);
		expect(chosen).toMatch(/aria-current="page"[^>]*>Paris, Texas, United States</);
	});

	it("leaves the map where it was when no City starts with it", async () => {
		const { client, db } = createTestDatabase();
		await loadSampleCityList(db, insertUser(client, "root_admin", "admin").id);

		const { html } = await renderPage(ExplorePage, { db, session: null }, `${copenhagen}&q=odensee`);

		const { center } = visitorMap({ center: { latitude: 55.6761, longitude: 12.5683 }, zoom: 12 });
		expect(html).toContain("No city starts with “odensee”.");
		expect(mapCenterOf(html).latitude).toBeCloseTo(center.latitude, 5);
		expect(mapCenterOf(html).longitude).toBeCloseTo(center.longitude, 5);
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

	it("leads a User back to their location from elsewhere", async () => {
		const { client, db } = createTestDatabase();
		const ada = insertUser(client, "ada");
		await db.users.setLocation(ada.id, ada.username, defaultMapCenter);

		const { html } = await renderPage(ExplorePage, { db, session: await signIn(db, ada.id) }, copenhagen);

		expect(html).toContain("Back to your location");
		expect(html).toContain("Set this as your location");
	});

	it("asks a Visitor in a dialog to log in to set their location, and brings them back to the same place on the map", async () => {
		const { db } = createTestDatabase();

		const { html } = await renderPage(ExplorePage, { db, session: null }, copenhagen);

		expect(html).not.toContain('method="post"');
		expect(html).toContain(`<button class="link cursor-pointer" type="button" commandfor="login-set-location" command="show-modal">Set this as your location</button>`);
		expect(dialogIn(html, "login-set-location")).toContain(`href="/api/google?next=${encodeURIComponent(copenhagen)}"`);
	});
});
