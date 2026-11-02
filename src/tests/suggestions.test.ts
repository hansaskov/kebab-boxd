import { describe, expect, it } from "vitest";
import { finishedSuggestionRetentionSeconds } from "@src/data/retention-periods";
import type { Database } from "@src/db";
import { isProblem } from "@src/db/problem";
import { maxAttempts, maxQueuedPerUser } from "@src/db/suggestion-queue";
import type { Place } from "@src/map/google-maps";
import type { Address } from "@src/map/nominatim";
import { processNextSuggestion } from "@src/suggestion-queue";
import { createTestDatabase, insertUser } from "@src/tests/database";

const shareLink = "https://maps.app.goo.gl/XEqFEXq6aNBqJRFJA";
// A link to a place whose name is not valid percent-encoding, so it is never looked up.
const unreadableLink = "https://www.google.com/maps/place/Kebab%E0%A4/data=!1s0x1:0x2!3d55!4d10";

const shawarmaVillage: Place = {
	name: "Shawarma Village",
	googleMapsId: "0x464cdf40a60240ff:0x42ef3a5ea295d42e",
	latitude: 55.3956231,
	longitude: 10.3827639,
};

const address: Address = { addressLine1: "Kongensgade 13", postalCode: "5000", city: "Odense", country: "Denmark" };

async function queue(db: Database, userId: number, link = shareLink) {
	const result = await db.suggestionQueue.queue(userId, link);
	if (isProblem(result)) throw new Error(`The link was not queued: ${result.problem}.`);
	return result.id;
}

describe("the SuggestionQueue", () => {
	it("turns a link into a pending Restaurant suggested by the User, and lets the link go", async () => {
		const { client, db } = createTestDatabase();
		const ada = insertUser(client, "ada");

		const result = await db.suggestionQueue.finish(await queue(db, ada.id), shawarmaVillage, address);

		expect(result.status).toBe("suggested");
		const restaurant = client.query.restaurants.findFirst({ with: { location: true } }).sync();
		expect(restaurant).toMatchObject({ name: "Shawarma Village", googleMapsId: shawarmaVillage.googleMapsId, status: "pending", suggestedBy: ada.id });
		expect(restaurant?.location).toMatchObject({ ...address, latitude: shawarmaVillage.latitude, longitude: shawarmaVillage.longitude });
		expect(client.query.suggestionQueue.findMany().sync()).toEqual([]);
	});

	it("knows a Restaurant that is approved or pending by its GoogleMapsId or by its name close by, but not a rejected one", async () => {
		const { client, db } = createTestDatabase();
		const admin = insertUser(client, "root_admin", "admin");
		const ada = insertUser(client, "ada");
		const finish = async (place: Place) => (await db.suggestionQueue.finish(await queue(db, ada.id), place, address)).status;
		const first = await db.suggestionQueue.finish(await queue(db, ada.id), { ...shawarmaVillage, name: "Døner Village" }, address);
		if (first.status !== "suggested") throw new Error(`The first link became ${first.status}.`);

		expect(await finish({ ...shawarmaVillage, name: "Another name" })).toBe("duplicate");
		expect(await finish({ ...shawarmaVillage, googleMapsId: "0x1:0x2", name: "DØNER VILLAGE", latitude: 55.3962 })).toBe("duplicate");
		expect(await finish({ ...shawarmaVillage, googleMapsId: "0x1:0x3", name: "Doner Village", latitude: 55.3962 })).toBe("suggested");
		expect(await finish({ ...shawarmaVillage, googleMapsId: "0x1:0x4", name: "Døner Village", latitude: 56.1567, longitude: 10.2108 })).toBe("suggested");

		await db.restaurants.decide(admin.id, first.id, "approved");
		expect(await finish({ ...shawarmaVillage, name: "Døner Village" })).toBe("duplicate");

		await db.restaurants.decide(admin.id, first.id, "rejected");
		expect(await finish({ ...shawarmaVillage, name: "Døner Village" })).toBe("suggested");
	});

	it("holds a few links of each User at a time", async () => {
		const { client, db } = createTestDatabase();
		const ada = insertUser(client, "ada");
		const bob = insertUser(client, "bob");
		for (let link = 0; link < maxQueuedPerUser; link++) await queue(db, ada.id);

		expect(await db.suggestionQueue.queue(ada.id, shareLink)).toEqual({ problem: "queue-full" });
		expect(await db.suggestionQueue.queue(bob.id, shareLink)).not.toHaveProperty("problem");
	});

	it("tries a link again later while Google or OpenStreetMap cannot be reached, and gives up after the last attempt", async () => {
		const { client, db } = createTestDatabase();
		const ada = insertUser(client, "ada");
		const queued = await queue(db, ada.id);
		const start = new Date();
		const row = () => client.query.suggestionQueue.findFirst({ where: { id: queued } }).sync();

		await db.suggestionQueue.retryLater(queued, start);

		expect(row()).toMatchObject({ status: "queued", attempts: 1 });
		expect(await processNextSuggestion(db, start)).toMatchObject({ processed: false });

		for (let attempt = 2; attempt <= maxAttempts; attempt++) await db.suggestionQueue.retryLater(queued, start);

		expect(row()).toMatchObject({ status: "failed", attempts: maxAttempts });
		expect(await db.suggestionQueue.next()).toBeUndefined();
	});

	it("does not try again a link that cannot be read, and forgets it after the retention period", async () => {
		const { client, db } = createTestDatabase();
		const ada = insertUser(client, "ada");
		await queue(db, ada.id, unreadableLink);

		expect(await processNextSuggestion(db)).toEqual({ processed: true });
		expect(client.query.suggestionQueue.findFirst().sync()).toMatchObject({ status: "not-a-place", attempts: 0 });

		const waiting = await queue(db, ada.id);
		const later = new Date(Date.now() + (finishedSuggestionRetentionSeconds + 60) * 1000);
		await db.retention.purge(later);

		expect(client.query.suggestionQueue.findMany({ columns: { id: true } }).sync()).toEqual([{ id: waiting }]);
	});
});
