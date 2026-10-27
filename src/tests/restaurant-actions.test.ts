import { describe, expect, it } from "vitest";
import { isInputError } from "astro:actions";
import { server } from "@src/actions/index";
import type { SessionWithUser } from "@src/auth/session";
import type { Database } from "@src/db";
import AdminRestaurantsPage from "@src/pages/admin/restaurants/index.astro";
import ProfilePage from "@src/pages/[username]/profile.astro";
import RestaurantPage from "@src/pages/restaurants/[id].astro";
import SuggestPage from "@src/pages/restaurants/suggest.astro";
import { actionContext, form, withActionResult } from "@src/tests/actions";
import { listRowLinks, renderPage } from "@src/tests/container";
import { createTestDatabase, insertRestaurant, insertUser, restaurantRow, signIn } from "@src/tests/database";

const link = "https://maps.app.goo.gl/XEqFEXq6aNBqJRFJA";

function suggest(db: Database, session: SessionWithUser, value = link) {
	return server.restaurants.suggest.call(actionContext(db, session), form({ link: value }));
}

function renderRestaurant(db: Database, session: SessionWithUser, id: number) {
	return renderPage(RestaurantPage, { db, session }, `/restaurants/${id}`, { id: String(id) });
}

function listedNames(html: string) {
	return listRowLinks(html).map((link) => link.text);
}

describe("favorite and bucket list actions", () => {
	it("save a restaurant once, however often the form is sent, show it on the profile and remove it again", async () => {
		const { client, db } = createTestDatabase("collect-restaurant");
		const ada = insertUser(client, "ada");
		const grill = insertRestaurant(client, "Bosporus Grill", { status: "approved" });
		const session = await signIn(db, ada.id);
		const context = actionContext(db, session);
		const target = form({ restaurantId: grill.id });
		const profile = (tab: string) => renderPage(ProfilePage, { db, session }, `/ada/profile?tab=${tab}`, { username: "ada" });

		for (const action of [server.restaurants.favorite, server.restaurants.favorite, server.restaurants.addToBucketList]) {
			expect((await action.call(context, target)).error).toBeUndefined();
		}

		expect(client.query.favorites.findMany().sync()).toHaveLength(1);
		expect(listedNames((await profile("favorites")).html)).toEqual(["Bosporus Grill"]);
		expect(listedNames((await profile("bucket-list")).html)).toEqual(["Bosporus Grill"]);
		expect((await renderRestaurant(db, session, grill.id)).html.match(/aria-pressed="true"/g)).toHaveLength(2);

		await server.restaurants.unfavorite.call(context, target);
		await server.restaurants.removeFromBucketList.call(context, target);

		expect(client.query.favorites.findMany().sync()).toEqual([]);
		expect(client.query.bucketList.findMany().sync()).toEqual([]);
	});

	it("do not save a restaurant that is waiting for approval, but remove one that was rejected after it was saved", async () => {
		const { client, db } = createTestDatabase("collect-pending");
		const admin = insertUser(client, "root_admin", "admin");
		const ada = insertUser(client, "ada");
		const pending = insertRestaurant(client, "Mangal Express", { suggestedBy: ada.id });
		const grill = insertRestaurant(client, "Bosporus Grill", { status: "approved" });
		const context = actionContext(db, await signIn(db, ada.id));

		expect((await server.restaurants.favorite.call(context, form({ restaurantId: pending.id }))).error?.code).toBe("FORBIDDEN");

		await server.restaurants.favorite.call(context, form({ restaurantId: grill.id }));
		await db.mutations.restaurants.setStatus(admin.id, grill.id, "rejected");
		await server.restaurants.unfavorite.call(context, form({ restaurantId: grill.id }));

		expect(client.query.favorites.findMany().sync()).toEqual([]);
	});

	it("are offered to remove a restaurant only on the own profile", async () => {
		const { client, db } = createTestDatabase("collect-remove-button");
		const ada = insertUser(client, "ada");
		const bob = insertUser(client, "bob");
		const grill = insertRestaurant(client, "Bosporus Grill", { status: "approved" });
		await db.mutations.restaurants.collect(ada.id, grill.id, "favorites");
		const render = async (userId: number) =>
			(await renderPage(ProfilePage, { db, session: await signIn(db, userId) }, "/ada/profile?tab=favorites", { username: "ada" })).html;

		expect(await render(ada.id)).toContain("Remove from favorites: Bosporus Grill");
		expect(await render(bob.id)).not.toContain("Remove from favorites");
	});
});

describe("restaurants.suggest action", () => {
	it("puts the link in the queue and shows it to the user who sent it", async () => {
		const { client, db } = createTestDatabase("suggest-restaurant");
		const ada = insertUser(client, "ada");
		const session = await signIn(db, ada.id);

		const result = await suggest(db, session);
		const html = (await renderPage(SuggestPage, withActionResult({ db, session }, "restaurants.suggest", result), "/restaurants/suggest")).html;

		expect(result.error).toBeUndefined();
		expect(client.query.suggestionQueue.findMany().sync()).toMatchObject([{ userId: ada.id, link, status: "queued" }]);
		expect(html).toContain("Thank you for the suggestion");
		expect(html).toContain("Looking it up");
	});

	it("refuses links that are not to a place on Google Maps", async () => {
		const { client, db } = createTestDatabase("suggest-link");
		const ada = insertUser(client, "ada");
		const session = await signIn(db, ada.id);

		for (const value of [
			"Vestergade 10, Odense",
			"http://maps.app.goo.gl/XEqFEXq6aNBqJRFJA",
			"https://maps.app.goo.gl.example.com/XEqFEXq6aNBqJRFJA",
			"https://www.google.com/maps/@55.3956,10.3794,16z",
			"https://example.com/maps/place/Shawarma+Village/",
		]) {
			const result = await suggest(db, session, value);
			expect(result.error && isInputError(result.error) && result.error.fields.link, value).toBeTruthy();
		}
		expect(client.query.suggestionQueue.findMany().sync()).toEqual([]);
	});

	it("lets a user have 5 links waiting at a time", async () => {
		const { client, db } = createTestDatabase("suggest-full");
		const ada = insertUser(client, "ada");
		const bob = insertUser(client, "bob");
		const session = await signIn(db, ada.id);

		for (let i = 0; i < 5; i++) expect((await suggest(db, session)).error).toBeUndefined();
		const sixth = await suggest(db, session);
		const other = await suggest(db, await signIn(db, bob.id));

		expect(sixth.error?.code).toBe("TOO_MANY_REQUESTS");
		expect(other.error).toBeUndefined();
	});
});

describe("approveRestaurant and rejectRestaurant actions", () => {
	it("let an admin decide on a suggestion, and no one else", async () => {
		const { client, db } = createTestDatabase("moderate-restaurant");
		const admin = insertUser(client, "root_admin", "admin");
		const ada = insertUser(client, "ada");
		const adaSession = await signIn(db, ada.id);
		const { id } = insertRestaurant(client, "Mangal Express", { suggestedBy: ada.id });
		const target = form({ restaurantId: id });

		const byAda = await server.admin.approveRestaurant.call(actionContext(db, adaSession), target);
		const byAdmin = await server.admin.approveRestaurant.call(actionContext(db, await signIn(db, admin.id)), target);

		expect(byAda.error?.code).toBe("FORBIDDEN");
		expect(byAdmin.error).toBeUndefined();
		expect(restaurantRow(client, id)?.status).toBe("approved");

		await server.admin.rejectRestaurant.call(actionContext(db, await signIn(db, admin.id)), target);

		expect(restaurantRow(client, id)?.status).toBe("rejected");
	});

	it("are offered to admins for the waiting suggestions, the oldest first", async () => {
		const { client, db } = createTestDatabase("moderate-queue");
		const admin = insertUser(client, "root_admin", "admin");
		const ada = insertUser(client, "ada");
		insertRestaurant(client, "Mangal Express", { suggestedBy: ada.id });
		insertRestaurant(client, "Hasir Kebab", { suggestedBy: ada.id });
		insertRestaurant(client, "Bosporus Grill", { status: "approved" });

		const { html } = await renderPage(AdminRestaurantsPage, { db, session: await signIn(db, admin.id) }, "/admin/restaurants");
		const asUser = await renderPage(AdminRestaurantsPage, { db, session: await signIn(db, ada.id) }, "/admin/restaurants");

		expect(listedNames(html)).toEqual(["Mangal Express", "Hasir Kebab"]);
		expect(html.match(/>Approve</g)).toHaveLength(2);
		expect(asUser.response.status).toBe(403);
	});
});
