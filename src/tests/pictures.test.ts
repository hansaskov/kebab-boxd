import sharp from "sharp";
import { describe, expect, it } from "vitest";
import * as PictureEndpoint from "@src/pages/pictures/[name]";
import type { Database } from "@src/db";
import { requestEndpoint } from "@src/tests/container";
import { createTestDatabase, insertRestaurant, insertUser, writeReview } from "@src/tests/database";
import { storedPictureNames } from "@src/tests/cloudflare";
import { nameOf, pictureFile, textFile } from "@src/tests/pictures";
import { updateProfilePictureSchema } from "@src/actions/settings";
import { maxPictureBytes } from "@src/validation/picture";
import { createReviewSchema } from "@src/validation/review";

function requestPicture(db: Database, url: string) {
	return requestEndpoint(PictureEndpoint, { db, session: null }, url, { name: nameOf(url) });
}

async function picturesOf(db: Database, reviewId: number, viewerId: number) {
	return (await db.reviews.findById(reviewId, viewerId))?.pictures ?? [];
}

function setUp() {
	const test = createTestDatabase();
	const ada = insertUser(test.client, "ada");
	const grill = insertRestaurant(test.client, "Bosporus Grill", { status: "approved" });
	return { ...test, ada, grill };
}

describe("Pictures", () => {
	it("are stored upright, without the metadata of the camera, and served only to the browser that asks", async () => {
		const { db, ada, grill } = setUp();
		const rotated = await pictureFile("rotated.jpg", { width: 40, height: 20, orientation: 6, description: "Our address" });
		const review = await writeReview(db, ada.id, grill.id, 8, [rotated]);
		const [picture] = await picturesOf(db, review, ada.id);

		const response = await requestPicture(db, picture!.url);
		const metadata = await sharp(Buffer.from(await response.arrayBuffer())).metadata();

		expect(response.headers.get("Content-Type")).toBe("image/webp");
		expect(response.headers.get("Cache-Control")).toBe("private, max-age=31536000, immutable");
		expect(metadata).toMatchObject({ format: "webp", width: 20, height: 40 });
		expect(metadata.exif).toBeUndefined();
		expect(metadata.orientation).toBeUndefined();
	});

	it("are not read when the write they belong to is refused", async () => {
		const { client, db, ada, grill } = setUp();
		const bob = insertUser(client, "bob");
		const pending = insertRestaurant(client, "Pending Grill");
		const review = await writeReview(db, ada.id, grill.id, 8);

		// The file is no picture, so a write that reads it is refused for that instead.
		const results = [
			await db.reviews.create(bob.id, pending.id, { rating: 8, description: null }, [textFile()]),
			await db.reviews.update(bob.id, review, { rating: 4, description: null, addPictures: [textFile()], removePictureIds: [] }),
			await db.users.setProfilePicture(bob.id, ada.username, textFile()),
		];

		expect(results).toEqual([
			{ problem: "not-found", permission: "restaurant:review" },
			{ problem: "forbidden", permission: "review:edit" },
			{ problem: "forbidden", permission: "user:edit-settings" },
		]);
	});

	it("are refused together with the review when one file is not a picture, and leave no files behind", async () => {
		const { client, db, ada, grill } = setUp();

		const result = await db.reviews.create(ada.id, grill.id, { rating: 8, description: null }, [await pictureFile(), textFile()]);

		expect(result).toEqual({ problem: "invalid-picture" });
		expect(client.query.reviews.findMany().sync()).toEqual([]);
		expect(await storedPictureNames()).toEqual([]);
	});

	it("are removed from storage when taken off the review, with the review, and with the account of the author", async () => {
		const { db, ada, grill } = setUp();
		const kept = await writeReview(db, ada.id, grill.id, 8, [await pictureFile(), await pictureFile()]);
		const deleted = await writeReview(db, ada.id, grill.id, 8, [await pictureFile()]);
		await db.users.setProfilePicture(ada.id, ada.username, await pictureFile());
		const [, removed] = await picturesOf(db, kept, ada.id);

		await db.reviews.update(ada.id, kept, { rating: 8, description: null, addPictures: [], removePictureIds: [removed!.id] });
		await db.reviews.delete(ada.id, deleted);

		expect(await storedPictureNames()).toHaveLength(2);
		expect((await requestPicture(db, removed!.url)).status).toBe(404);

		await db.users.delete(ada.id, ada.username);

		expect(await storedPictureNames()).toEqual([]);
	});

	it("stay as they were when a change to the review is refused", async () => {
		const { db, ada, grill } = setUp();
		const review = await writeReview(db, ada.id, grill.id, 8, [await pictureFile(), await pictureFile(), await pictureFile()]);
		const before = await storedPictureNames();
		const [first] = await picturesOf(db, review, ada.id);

		const result = await db.reviews.update(ada.id, review, {
			rating: 8,
			description: null,
			addPictures: [await pictureFile(), await pictureFile(), await pictureFile()],
			removePictureIds: [first!.id],
		});

		expect(result).toEqual({ problem: "too-many-pictures" });
		expect(await storedPictureNames()).toEqual(before);
		expect(await picturesOf(db, review, ada.id)).toHaveLength(3);
	});

	it("are optional, whether the empty file input sends an empty file or an empty string", () => {
		for (const empty of [new File([], ""), ""]) {
			const input = { restaurantId: 1, rating: 8, description: null, pictures: [empty] };
			expect(createReviewSchema.parse(input).pictures).toEqual([]);
		}
	});

	it("are required for a profile, whether the empty file input sends an empty file or an empty string", () => {
		for (const empty of [new File([], ""), ""]) {
			const result = updateProfilePictureSchema.safeParse({ currentUsername: "ada", picture: empty });
			expect(result.error?.issues.map((issue) => [issue.path, issue.message])).toEqual([[["picture"], "Choose a picture."]]);
		}
	});

	it("are refused when larger than the limit, both for a profile and for a review", () => {
		const large = new File([new Uint8Array(maxPictureBytes + 1)], "large.jpg", { type: "image/jpeg" });

		const profile = updateProfilePictureSchema.safeParse({ currentUsername: "ada", picture: large });
		const review = createReviewSchema.safeParse({ restaurantId: 1, rating: 8, description: null, pictures: [large] });

		expect(profile.error?.issues.map((issue) => issue.message)).toEqual(["A picture can be at most 10 MB."]);
		expect(review.error?.issues.map((issue) => issue.message)).toEqual(["A picture can be at most 10 MB."]);
	});

	it("are never read from outside the picture bucket", async () => {
		const { db } = createTestDatabase();

		for (const url of ["/pictures/aaaaaaaaaaaaaaaaaaaaaaaa.webp", "/pictures/..%2F..%2Fdb.sqlite"]) {
			expect((await requestPicture(db, url)).status, url).toBe(404);
		}
	});
});
