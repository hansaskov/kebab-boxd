import { experimental_AstroContainer as AstroContainer } from "astro/container";
import sharp from "sharp";
import { describe, expect, it } from "vitest";
import { isInputError } from "astro:actions";
import { server } from "@src/actions/index";
import type { SessionWithUser } from "@src/auth/session";
import type { Database } from "@src/db";
import * as PictureEndpoint from "@src/pages/pictures/[name]";
import NotFoundPage from "@src/pages/404.astro";
import { actionContext, form } from "@src/tests/actions";
import { renderEndpoint } from "@src/tests/container";
import { createTestDatabase, insertRestaurant, insertUser, signIn } from "@src/tests/database";
import { emptyFileInput, nameOf, pictureFile, storedPictureNames, textFile } from "@src/tests/pictures";

async function requestPicture(db: Database, url: string) {
	const container = await AstroContainer.create();
	container.insertPageRoute("/404", NotFoundPage);
	return renderEndpoint(container, PictureEndpoint, {
		locals: { db, session: null },
		params: { name: nameOf(url) },
		request: new Request(`http://localhost${url}`),
	});
}

function publish(db: Database, session: SessionWithUser, restaurantId: number, pictures: File[]) {
	return server.reviews.create.call(actionContext(db, session), form({ restaurantId, rating: 8, pictures }));
}

async function picturesOf(db: Database, reviewId: number, viewerId: number) {
	return (await db.queries.reviews.findById(reviewId, viewerId))?.pictures ?? [];
}

async function setUp(name: string) {
	const test = createTestDatabase(name);
	const ada = insertUser(test.client, "ada");
	const grill = insertRestaurant(test.client, "Bosporus Grill", { status: "approved" });
	return { ...test, ada, grill, session: await signIn(test.db, ada.id) };
}

describe("pictures of a review", () => {
	it("are stored upright as WebP without the metadata of the camera, and served to the browser", async () => {
		const { db, picturesDirectory, ada, grill, session } = await setUp("review-pictures-stored");
		const rotated = await pictureFile("rotated.jpg", { width: 40, height: 20, orientation: 6, description: "Our address" });

		const result = await publish(db, session, grill.id, [rotated, await pictureFile(), emptyFileInput()]);
		const reviewId = Number(result.data?.redirect.split("/").at(-1));
		const pictures = await picturesOf(db, reviewId, ada.id);

		expect(pictures).toHaveLength(2);
		expect(storedPictureNames(picturesDirectory)).toEqual(pictures.map((picture) => nameOf(picture.url)).toSorted());

		const response = await requestPicture(db, pictures[0]!.url);
		const metadata = await sharp(Buffer.from(await response.arrayBuffer())).metadata();

		expect(response.headers.get("Content-Type")).toBe("image/webp");
		expect(response.headers.get("Cache-Control")).toBe("private, max-age=31536000, immutable");
		expect(metadata).toMatchObject({ format: "webp", width: 20, height: 40 });
		expect(metadata.exif).toBeUndefined();
		expect(metadata.orientation).toBeUndefined();
	});

	it("are refused together with the review when one file is not a picture, and leave no files behind", async () => {
		const { client, db, picturesDirectory, grill, session } = await setUp("review-pictures-invalid");

		const result = await publish(db, session, grill.id, [await pictureFile(), textFile()]);

		expect(result.error?.code).toBe("BAD_REQUEST");
		expect(result.error?.message).toContain("is not a picture");
		expect(client.query.reviews.findMany().sync()).toEqual([]);
		expect(client.query.pictures.findMany().sync()).toEqual([]);
		expect(storedPictureNames(picturesDirectory)).toEqual([]);
	});

	it("are four at most, also when pictures are added to a review later", async () => {
		const { db, picturesDirectory, ada, grill, session } = await setUp("review-pictures-limit");
		const five = await Promise.all(Array.from({ length: 5 }, () => pictureFile()));

		const tooMany = await publish(db, session, grill.id, five);
		const three = await publish(db, session, grill.id, five.slice(0, 3));
		const reviewId = Number(three.data?.redirect.split("/").at(-1));
		const addTwo = await server.reviews.update.call(
			actionContext(db, session),
			form({ reviewId, rating: 8, description: "", pictures: five.slice(0, 2) }),
		);

		expect(tooMany.error && isInputError(tooMany.error) && tooMany.error.fields.pictures).toEqual(["Add at most 4 pictures."]);
		expect(addTwo.error?.message).toBe("A review can have at most 4 pictures.");
		expect(await picturesOf(db, reviewId, ada.id)).toHaveLength(3);
		expect(storedPictureNames(picturesDirectory)).toHaveLength(3);
	});

	it("are removed from storage when the author takes them off the review, and when the review is deleted", async () => {
		const { db, picturesDirectory, ada, grill, session } = await setUp("review-pictures-removed");
		const result = await publish(db, session, grill.id, [await pictureFile(), await pictureFile()]);
		const reviewId = Number(result.data?.redirect.split("/").at(-1));
		const [kept, removed] = await picturesOf(db, reviewId, ada.id);

		await server.reviews.update.call(
			actionContext(db, session),
			form({ reviewId, rating: 6, description: "", removePictureIds: [removed!.id], pictures: [await pictureFile()] }),
		);
		const afterUpdate = await picturesOf(db, reviewId, ada.id);

		expect(afterUpdate.map((picture) => picture.id)).toContain(kept!.id);
		expect(afterUpdate).toHaveLength(2);
		expect(storedPictureNames(picturesDirectory)).toEqual(afterUpdate.map((picture) => nameOf(picture.url)).toSorted());
		expect((await requestPicture(db, removed!.url)).status).toBe(404);

		await server.reviews.delete.call(actionContext(db, session), form({ reviewId }));

		expect(storedPictureNames(picturesDirectory)).toEqual([]);
	});

	it("are removed from storage with the account of the author", async () => {
		const { client, db, picturesDirectory, ada, grill, session } = await setUp("review-pictures-account");
		await publish(db, session, grill.id, [await pictureFile()]);
		await server.updateProfilePicture.call(actionContext(db, session), form({ currentUsername: "ada", picture: await pictureFile() }));

		expect(storedPictureNames(picturesDirectory)).toHaveLength(2);

		await db.mutations.users.delete(ada.id, ada.id);

		expect(storedPictureNames(picturesDirectory)).toEqual([]);
		expect(client.query.pictures.findMany().sync()).toEqual([]);
	});
});

describe("GET /pictures/[name]", () => {
	it("does not serve a missing picture or a file outside the picture folder", async () => {
		const { db } = createTestDatabase("picture-endpoint-missing");

		for (const url of ["/pictures/aaaaaaaaaaaaaaaaaaaaaaaa.webp", "/pictures/..%2F..%2Fdb.sqlite"]) {
			expect((await requestPicture(db, url)).status).toBe(404);
		}
	});
});
