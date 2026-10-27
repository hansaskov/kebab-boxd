import { isProblem } from "@src/db/mutations/authorize";
import { describe, expect, it, vi } from "vitest";
import { finishedSuggestionRetentionSeconds } from "@src/data/retention-periods";
import type { Database } from "@src/db";
import { maxAttempts, maxQueuedPerUser } from "@src/db/mutations/suggestion-queue";
import type { FinishResult } from "@src/db/mutations/suggestion-queue";
import * as s from "@src/db/schema";
import type { Place } from "@src/map/google-maps";
import type { Address } from "@src/map/nominatim";
import RestaurantPage from "@src/pages/restaurants/[id].astro";
import SuggestPage from "@src/pages/restaurants/suggest.astro";
import { processNextSuggestion, scheduleSuggestionQueue } from "@src/suggestion-queue";
import { renderPage } from "@src/tests/container";
import { createTestDatabase, insertRestaurant, insertUser, restaurantRow, signIn } from "@src/tests/database";

const shareLink = "https://maps.app.goo.gl/XEqFEXq6aNBqJRFJA";

const shawarmaVillage: Place = {
	name: "Shawarma Village",
	googleMapsId: "0x464cdf40a60240ff:0x42ef3a5ea295d42e",
	latitude: 55.3956231,
	longitude: 10.3827639,
};

const address: Address = { addressLine1: "Kongensgade 13", postalCode: "5000", city: "Odense", country: "Denmark" };

async function queue(db: Database, userId: number) {
	const result = await db.mutations.suggestionQueue.queue(userId, shareLink);
	if (isProblem(result)) throw new Error("The link was not queued.");
	return result.id;
}

function suggestedId(result: FinishResult) {
	if (result.status !== "suggested") throw new Error(`The link became ${result.status}.`);
	return result.id;
}

async function suggestPage(db: Database, userId: number) {
	return (await renderPage(SuggestPage, { db, session: await signIn(db, userId) }, "/restaurants/suggest")).html;
}

describe("suggestion queue", () => {
	it("turns a link into a restaurant waiting for approval, seen only by the user who sent it and by admins", async () => {
		const { client, db } = createTestDatabase("queue-suggest");
		const admin = insertUser(client, "root_admin", "admin");
		const ada = insertUser(client, "ada");
		const bob = insertUser(client, "bob");
		const queued = await queue(db, ada.id);

		const id = suggestedId(await db.mutations.suggestionQueue.finish(queued, shawarmaVillage, address));
		const asUser = async (userId: number) =>
			renderPage(RestaurantPage, { db, session: await signIn(db, userId) }, `/restaurants/${id}`, { id: String(id) });

		expect(restaurantRow(client, id)).toMatchObject({
			name: "Shawarma Village",
			googleMapsId: shawarmaVillage.googleMapsId,
			status: "pending",
			suggestedBy: ada.id,
		});
		expect(client.query.locations.findFirst().sync()).toMatchObject({ ...address, latitude: 55.3956231, longitude: 10.3827639 });
		expect(client.query.suggestionQueue.findMany().sync()).toEqual([]);
		expect((await asUser(ada.id)).html).toContain("Kongensgade 13, 5000 Odense, Denmark");
		expect((await asUser(bob.id)).response.status).toBe(404);
		expect((await asUser(admin.id)).html).toContain(">Approve<");
		expect(await suggestPage(db, ada.id)).toContain("Waiting for approval");
	});

	it("catches a restaurant already on Kebab Boxd or waiting, by its id or its name close by, but not a rejected one", async () => {
		const { client, db } = createTestDatabase("queue-duplicate");
		const admin = insertUser(client, "root_admin", "admin");
		const ada = insertUser(client, "ada");
		const finish = async (place: Place) => db.mutations.suggestionQueue.finish(await queue(db, ada.id), place, address);

		const first = await finish(shawarmaVillage);
		const sameId = await finish({ ...shawarmaVillage, name: "Shawarma Village Odense" });
		const sameName = await finish({ ...shawarmaVillage, googleMapsId: "0x1:0x2", name: "SHAWARMA VILLAGE", latitude: 55.3962 });
		const elsewhere = await finish({ ...shawarmaVillage, googleMapsId: "0x1:0x3", latitude: 56.1567, longitude: 10.2108 });
		const firstId = suggestedId(first);
		const whilePending = await suggestPage(db, ada.id);
		await db.mutations.restaurants.setStatus(admin.id, firstId, "approved");
		const approved = await finish(shawarmaVillage);
		const whileApproved = await suggestPage(db, ada.id);
		await db.mutations.restaurants.setStatus(admin.id, firstId, "rejected");
		const again = await finish(shawarmaVillage);
		const whileRejected = await suggestPage(db, ada.id);

		expect([first, sameId, sameName, elsewhere, approved, again].map((result) => result.status)).toEqual([
			"suggested",
			"duplicate",
			"duplicate",
			"suggested",
			"duplicate",
			"suggested",
		]);
		expect(client.query.restaurants.findMany().sync()).toHaveLength(3);
		expect(whilePending.match(/Already suggested/g)).toHaveLength(2);
		expect(whileApproved.match(/Already on Kebab Boxd/g)).toHaveLength(3);
		expect(whileApproved).toContain(`href="/restaurants/${firstId}"`);
		expect(whileRejected).not.toContain("Already");
	});

	it("catches the same name in another case also outside the letters A to Z", async () => {
		const { client, db } = createTestDatabase("queue-duplicate-case");
		const ada = insertUser(client, "ada");
		const finish = async (place: Place) => db.mutations.suggestionQueue.finish(await queue(db, ada.id), place, address);

		const first = await finish({ ...shawarmaVillage, name: "Døner Kebab Ödense" });
		const upper = await finish({ ...shawarmaVillage, googleMapsId: "0x1:0x2", name: "DØNER KEBAB ÖDENSE" });
		const otherLetter = await finish({ ...shawarmaVillage, googleMapsId: "0x1:0x3", name: "Doner Kebab Odense" });

		expect([first, upper, otherLetter].map((result) => result.status)).toEqual(["suggested", "duplicate", "suggested"]);
	});

	it("tries a link again later while Google or OpenStreetMap cannot be reached, and gives up after the last attempt", async () => {
		const { client, db } = createTestDatabase("queue-retry");
		const ada = insertUser(client, "ada");
		const queued = await queue(db, ada.id);
		const start = new Date();
		const row = () => client.query.suggestionQueue.findFirst({ where: { id: queued } }).sync();

		await db.mutations.suggestionQueue.retryLater(queued, start);

		expect(row()).toMatchObject({ status: "queued", attempts: 1 });
		expect((await processNextSuggestion(db, start)).processed).toBe(false);
		expect((await db.queries.suggestionQueue.next())?.runAfter.getTime()).toBe(Math.floor(start.getTime() / 1000) * 1000 + 60_000);

		for (let attempt = 2; attempt <= maxAttempts; attempt++) await db.mutations.suggestionQueue.retryLater(queued, start);

		expect(row()).toMatchObject({ status: "failed", attempts: maxAttempts });
		expect(await db.queries.suggestionQueue.next()).toBeUndefined();
		expect(await suggestPage(db, ada.id)).toContain("Could not look it up");
	});

	it("keeps a link that is not to a place, and forgets it after the retention period", async () => {
		const { client, db } = createTestDatabase("queue-not-a-place");
		const ada = insertUser(client, "ada");
		const notAPlace = await queue(db, ada.id);
		const waiting = await queue(db, ada.id);
		await db.mutations.suggestionQueue.markNotAPlace(notAPlace);

		expect(await suggestPage(db, ada.id)).toContain("Not a restaurant link");

		const later = new Date(Date.now() + (finishedSuggestionRetentionSeconds + 60) * 1000);
		expect((await db.mutations.retention.purge(later)).suggestionQueue).toBe(1);
		expect(client.query.suggestionQueue.findMany({ columns: { id: true } }).sync()).toEqual([{ id: waiting }]);
	});

	it("lets a user have only a few links waiting at a time", async () => {
		const { client, db } = createTestDatabase("queue-full");
		const ada = insertUser(client, "ada");
		for (let link = 0; link < maxQueuedPerUser; link++) await queue(db, ada.id);

		expect(await db.mutations.suggestionQueue.queue(ada.id, shareLink)).toEqual({ problem: "queue-full" });
	});

	it("does not try a link again when it cannot be read", async () => {
		const { client, db } = createTestDatabase("queue-unreadable");
		const ada = insertUser(client, "ada");
		const link = "https://www.google.com/maps/place/Kebab%E0%A4/data=!1s0x1:0x2!3d55!4d10";
		await db.mutations.suggestionQueue.queue(ada.id, link);

		expect((await processNextSuggestion(db)).processed).toBe(true);
		expect(client.query.suggestionQueue.findFirst().sync()).toMatchObject({ status: "not-a-place", attempts: 0 });
	});

	it("does not queue a link for a user who was deleted after signing in", async () => {
		const { client, db } = createTestDatabase("queue-gone-user");
		const ada = insertUser(client, "ada");
		client.delete(s.users).run();

		expect(await db.mutations.suggestionQueue.queue(ada.id, shareLink)).toEqual({ problem: "account-gone" });
	});

	it("wakes up when a link is queued", async () => {
		const { client, db } = createTestDatabase("queue-wake");
		const ada = insertUser(client, "ada");
		const stop = scheduleSuggestionQueue(db);
		const row = () => client.query.suggestionQueue.findFirst({ columns: { status: true } }).sync();

		try {
			await vi.waitFor(async () => expect(await db.queries.suggestionQueue.next()).toBeUndefined());
			await db.mutations.suggestionQueue.queue(ada.id, "https://www.google.com/maps/place/Kebab%E0%A4/data=!1s0x1:0x2!3d55!4d10");

			await vi.waitFor(() => expect(row()).toEqual({ status: "not-a-place" }));
		} finally {
			stop();
		}
	});

	it("drops a link whose user is deleted while it is looked up", async () => {
		const { client, db } = createTestDatabase("queue-deleted-user");
		const ada = insertUser(client, "ada");
		const queued = await queue(db, ada.id);
		client.delete(s.users).run();

		expect(await db.mutations.suggestionQueue.finish(queued, shawarmaVillage, address)).toEqual({ status: "gone" });
		expect(client.query.restaurants.findMany().sync()).toEqual([]);
	});

	// Uses the internet, so it runs only with LIVE_TESTS=1: the share link is opened at Google and the address
	// is asked of OpenStreetMap. Google and OpenStreetMap can change their answers at any time.
	it.runIf(process.env.LIVE_TESTS === "1")("looks up a shared link on Google Maps and OpenStreetMap", async () => {
		const { client, db } = createTestDatabase("queue-live");
		const ada = insertUser(client, "ada");
		await queue(db, ada.id);
		insertRestaurant(client, "Bosporus Grill", { status: "approved" });

		expect((await processNextSuggestion(db)).processed).toBe(true);
		expect((await processNextSuggestion(db)).processed).toBe(false);

		const restaurant = client.query.restaurants.findFirst({ where: { name: "Shawarma Village" }, with: { location: true } }).sync();
		expect(restaurant).toMatchObject({ googleMapsId: shawarmaVillage.googleMapsId, status: "pending", suggestedBy: ada.id });
		expect(restaurant?.location).toMatchObject({ addressLine1: "Kongensgade 13", postalCode: "5000", city: "Odense", country: "Denmark" });
	});
});
