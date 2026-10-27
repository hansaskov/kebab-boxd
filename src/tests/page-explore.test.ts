import { describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import * as s from "@src/db/schema";
import ExplorePage from "@src/pages/explore.astro";
import { decode, renderPage } from "@src/tests/container";
import { createTestDatabase, insertRestaurant, insertUser, signIn } from "@src/tests/database";

function markerIds(html: string) {
	return [...html.matchAll(/<li class="map-marker" style="[^"]*"><a href="\/restaurants\/(\d+)"/g)].map((match) => Number(match[1]));
}

function nearby(html: string) {
	const section = html.slice(html.indexOf('id="nearby-heading"'));
	return [...section.matchAll(/class="list-row-link[^"]*"[^>]*>([^<]+)<\/a><p[^>]*>([^<·]+)/g)].map((match) => [match[1], match[2]!.trim()]);
}

function setUp(name: string) {
	const test = createTestDatabase(name);
	const near = insertRestaurant(test.client, "Near Kebab", { status: "approved", latitude: 55.401, longitude: 10.39 });
	const across = insertRestaurant(test.client, "Across Town Kebab", { status: "approved", latitude: 55.42, longitude: 10.39 });
	const aarhus = insertRestaurant(test.client, "Aarhus Kebab", { status: "approved", latitude: 56.1567, longitude: 10.2108, city: "Aarhus" });
	insertRestaurant(test.client, "Pending Kebab", { latitude: 55.4, longitude: 10.391 });
	return { ...test, near, across, aarhus };
}

describe("ExplorePage", () => {
	it("starts at the location of the user, with the restaurants in view on the map and the nearest listed by distance", async () => {
		const { client, db, near, across } = setUp("explore-home");
		const ada = insertUser(client, "ada");
		client.update(s.users).set({ latitude: 55.4, longitude: 10.39 }).where(eq(s.users.id, ada.id)).run();

		const { html } = await renderPage(ExplorePage, { db, session: await signIn(db, ada.id) }, "/explore");

		expect(markerIds(html).toSorted()).toEqual([near.id, across.id].toSorted());
		expect(nearby(html)).toEqual([
			["Near Kebab", "110 m"],
			["Across Town Kebab", "2.2 km"],
			["Aarhus Kebab", "84.9 km"],
		]);
		expect(html).toContain('title="Your location"');
		expect(html).toContain("https://tile.openstreetmap.org/13/");
		expect(html).toContain("OpenStreetMap</a> contributors");
	});

	it("moves and zooms the map with links, and keeps the zoom within what the tiles offer", async () => {
		const { client, db, aarhus } = setUp("explore-move");
		const ada = insertUser(client, "ada");
		const session = await signIn(db, ada.id);

		const moved = await renderPage(ExplorePage, { db, session }, "/explore?lat=56.1567&lng=10.2108&zoom=14");
		const deep = await renderPage(ExplorePage, { db, session }, "/explore?lat=56.1567&lng=10.2108&zoom=99");

		expect(markerIds(moved.html)).toEqual([aarhus.id]);
		expect(decode(moved.html)).toContain('href="/explore?lat=56.15670&lng=10.21080&zoom=15"');
		expect(decode(moved.html)).toContain('href="/explore?lat=56.15670&lng=10.21080&zoom=13"');
		expect(deep.html).toContain("https://tile.openstreetmap.org/18/");
		expect(deep.html).toMatch(/aria-disabled="true" title="Zoom in"/);
	});

	it("starts at the default place for a user without a location, and offers to set one", async () => {
		const { client, db, near } = setUp("explore-default");
		const ada = insertUser(client, "ada");

		const { html } = await renderPage(ExplorePage, { db, session: await signIn(db, ada.id) }, "/explore?lat=north&lng=10");

		expect(markerIds(html)).toContain(near.id);
		expect(html).toContain('href="/ada/settings#location"');
		expect(html).not.toContain('title="Your location"');
	});
});
