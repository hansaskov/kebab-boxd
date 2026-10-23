import { describe, expect, it } from "vitest";
import { isInputError } from "astro:actions";
import { server } from "@src/actions/index";
import type { SessionWithUser } from "@src/auth/session";
import type { Database } from "@src/db";
import AdminRestaurantsPage from "@src/pages/admin/restaurants/index.astro";
import ProfilePage from "@src/pages/[username]/profile.astro";
import RestaurantPage from "@src/pages/restaurants/[id].astro";
import { actionContext, form } from "@src/tests/actions";
import { renderPage } from "@src/tests/container";
import { createTestDatabase, insertRestaurant, insertUser, restaurantRow, signIn } from "@src/tests/database";

const suggestion = {
	name: "Kebab Palads",
	addressLine1: "Vestergade 10",
	postalCode: "5000",
	city: "Odense",
	country: "Denmark",
	coordinates: "55.3959, 10.3883",
};

function suggest(db: Database, session: SessionWithUser, fields: Partial<typeof suggestion> = {}) {
	return server.restaurants.suggest.call(actionContext(db, session), form({ ...suggestion, ...fields }));
}

function suggestedId(result: Awaited<ReturnType<typeof suggest>>) {
	const id = result.data?.redirect.match(/^\/restaurants\/(\d+)$/)?.[1];
	if (!id) throw new Error(`The restaurant was not suggested: ${result.error?.message}`);
	return Number(id);
}

function renderRestaurant(db: Database, session: SessionWithUser, id: number) {
	return renderPage(RestaurantPage, { db, session }, `/restaurants/${id}`, { id: String(id) });
}

function listedNames(html: string) {
	return [...html.matchAll(/class="field-label[^"]*"[^>]*>([^<]+)</g)].map((match) => match[1]);
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
		await db.mutations.restaurants.collect("favorites", ada.id, grill.id);
		const render = async (userId: number) =>
			(await renderPage(ProfilePage, { db, session: await signIn(db, userId) }, "/ada/profile?tab=favorites", { username: "ada" })).html;

		expect(await render(ada.id)).toContain("Remove from favorites: Bosporus Grill");
		expect(await render(bob.id)).not.toContain("Remove from favorites");
	});
});

describe("restaurants.suggest action", () => {
	it("adds the restaurant for an admin to approve, visible only to the user who suggested it and to admins", async () => {
		const { client, db } = createTestDatabase("suggest-restaurant");
		const admin = insertUser(client, "root_admin", "admin");
		const ada = insertUser(client, "ada");
		const bob = insertUser(client, "bob");
		const adaSession = await signIn(db, ada.id);

		const id = suggestedId(await suggest(db, adaSession));

		expect(restaurantRow(client, id)).toMatchObject({ name: "Kebab Palads", status: "pending", suggestedBy: ada.id });
		expect(client.query.locations.findFirst().sync()).toMatchObject({ city: "Odense", latitude: 55.3959, longitude: 10.3883 });
		expect((await renderRestaurant(db, adaSession, id)).html).toContain("Waiting for approval");
		expect((await renderRestaurant(db, await signIn(db, bob.id), id)).response.status).toBe(404);
		expect((await renderRestaurant(db, await signIn(db, admin.id), id)).html).toContain(">Approve<");
	});

	it("catches a restaurant that is already on Kebab Boxd or waiting, by its name close by, and lets a rejected one be suggested again", async () => {
		const { client, db } = createTestDatabase("suggest-duplicate");
		const admin = insertUser(client, "root_admin", "admin");
		const ada = insertUser(client, "ada");
		const session = await signIn(db, ada.id);
		const first = suggestedId(await suggest(db, session));

		const waiting = await suggest(db, session, { name: "KEBAB PALADS", coordinates: "55.3965, 10.3886" });
		await db.mutations.restaurants.setStatus(admin.id, first, "approved");
		const approved = await suggest(db, session, { name: "kebab palads" });
		const elsewhere = await suggest(db, session, { coordinates: "56.1567, 10.2108", city: "Aarhus" });
		await db.mutations.restaurants.setStatus(admin.id, first, "rejected");
		const again = await suggest(db, session);

		expect(waiting.error?.message).toBe("KEBAB PALADS is already waiting for an admin to approve it.");
		expect(approved.error?.message).toBe("kebab palads is already on Kebab Boxd.");
		expect(elsewhere.error).toBeUndefined();
		expect(again.error).toBeUndefined();
		expect(client.query.restaurants.findMany().sync()).toHaveLength(3);
	});

	it("refuses coordinates that are not on earth or not written as latitude and longitude", async () => {
		const { client, db } = createTestDatabase("suggest-coordinates");
		const ada = insertUser(client, "ada");
		const session = await signIn(db, ada.id);

		for (const coordinates of ["95, 10", "55.4 10.4", "Vestergade"]) {
			const result = await suggest(db, session, { coordinates });
			expect(result.error && isInputError(result.error) && result.error.fields.coordinates).toBeTruthy();
		}
		expect(client.query.restaurants.findMany().sync()).toEqual([]);
	});
});

describe("approveRestaurant and rejectRestaurant actions", () => {
	it("let an admin decide on a suggestion, and no one else", async () => {
		const { client, db } = createTestDatabase("moderate-restaurant");
		const admin = insertUser(client, "root_admin", "admin");
		const ada = insertUser(client, "ada");
		const adaSession = await signIn(db, ada.id);
		const id = suggestedId(await suggest(db, adaSession));
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
