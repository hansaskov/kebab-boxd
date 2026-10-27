import { describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import * as s from "@src/db/schema";
import RestaurantsPage from "@src/pages/restaurants/index.astro";
import RestaurantPage from "@src/pages/restaurants/[id].astro";
import { linkHref, listRowLinks, renderPage } from "@src/tests/container";
import { createTestDatabase, insertRestaurant, insertReview, insertUser, signIn } from "@src/tests/database";

function listedNames(html: string) {
	return listRowLinks(html).map((link) => link.text);
}

function setStats(client: ReturnType<typeof createTestDatabase>["client"], id: number, ratingAvg: number, reviewCount: number) {
	client.update(s.restaurants).set({ ratingAvg, reviewCount }).where(eq(s.restaurants.id, id)).run();
}

describe("RestaurantsPage", () => {
	it("lists the approved restaurants, the best rated first, and finds them by name or city", async () => {
		const { client, db } = createTestDatabase("restaurants-list");
		const ada = insertUser(client, "ada");
		const grill = insertRestaurant(client, "Bosporus Grill", { status: "approved" });
		const hasir = insertRestaurant(client, "Hasir Kebab", { status: "approved", city: "Aarhus" });
		insertRestaurant(client, "Mangal Express");
		setStats(client, grill.id, 6, 3);
		setStats(client, hasir.id, 9, 1);
		const session = await signIn(db, ada.id);
		const render = async (search: string) => listedNames((await renderPage(RestaurantsPage, { db, session }, `/restaurants${search}`)).html);

		expect(await render("")).toEqual(["Hasir Kebab", "Bosporus Grill"]);
		expect(await render("?sort=popular")).toEqual(["Bosporus Grill", "Hasir Kebab"]);
		expect(await render("?sort=newest")).toEqual(["Hasir Kebab", "Bosporus Grill"]);
		expect(await render("?q=grill")).toEqual(["Bosporus Grill"]);
		expect(await render("?q=aarhus")).toEqual(["Hasir Kebab"]);
		expect(await render("?q=mangal")).toEqual([]);
	});

	it("pages through restaurants with the same rating, which has no short decimal form, without skipping or repeating any", async () => {
		const { client, db } = createTestDatabase("restaurants-pages");
		const ada = insertUser(client, "ada");
		const restaurants = Array.from({ length: 12 }, (_, i) => insertRestaurant(client, `Kebab ${i}`, { status: "approved" }));
		const [lower, higher] = [restaurants.slice(0, 6), restaurants.slice(6)];
		for (const restaurant of lower) setStats(client, restaurant.id, 7.5, 1);
		for (const restaurant of higher) setStats(client, restaurant.id, 8 + 1 / 3, 1);
		const session = await signIn(db, ada.id);
		const names = [...higher.toReversed(), ...lower.toReversed()].map((restaurant) => restaurant.name);
		const visit = (path: string) => renderPage(RestaurantsPage, { db, session }, path);

		const first = await visit("/restaurants?rows=10");
		const second = await visit(linkHref(first.html, "next")!);
		const back = await visit(linkHref(second.html, "prev")!);

		expect(listedNames(first.html)).toEqual(names.slice(0, 10));
		expect(listedNames(second.html)).toEqual(names.slice(10));
		expect(linkHref(second.html, "next")).toBeUndefined();
		expect(listedNames(back.html)).toEqual(names.slice(0, 10));
	});
});

describe("RestaurantPage", () => {
	it("shows the address, the rating and the public reviews of the restaurant, and what the user can do", async () => {
		const { client, db } = createTestDatabase("restaurant-page");
		const ada = insertUser(client, "ada");
		const bob = insertUser(client, "bob");
		const grill = insertRestaurant(client, "Bosporus Grill", { status: "approved" });
		const day = 24 * 60 * 60 * 1000;
		for (const age of [4, 3, 2, 1]) {
			insertReview(client, bob.id, grill.id, 8, new Date(Date.now() - age * day));
		}
		setStats(client, grill.id, 8, 4);

		const { response, html } = await renderPage(RestaurantPage, { db, session: await signIn(db, ada.id) }, `/restaurants/${grill.id}`, {
			id: String(grill.id),
		});

		expect(response.status).toBe(200);
		expect(html).toContain("Odense");
		expect(html).toContain('aria-label="4.0 out of 5 stars"');
		expect(html).toContain("4 reviews");
		expect(html.match(/<article/g)).toHaveLength(3);
		expect(html).toContain(`href="/reviews/new?restaurant=${grill.id}"`);
		expect(html).toContain("https://tile.openstreetmap.org/16/");
	});

	it("does not exist for an address that is not a restaurant", async () => {
		const { client, db } = createTestDatabase("restaurant-page-missing");
		const ada = insertUser(client, "ada");
		const session = await signIn(db, ada.id);

		for (const id of ["404", "abc", "-1"]) {
			expect((await renderPage(RestaurantPage, { db, session }, `/restaurants/${id}`, { id })).response.status).toBe(404);
		}
	});
});
