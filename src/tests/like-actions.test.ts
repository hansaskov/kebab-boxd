import { describe, expect, it } from "vitest";
import { server } from "@src/actions/index";
import FeedPage from "@src/pages/index.astro";
import { actionContext, form } from "@src/tests/actions";
import { renderPage } from "@src/tests/container";
import { createTestDatabase, insertRestaurant, insertReview, insertUser, signIn } from "@src/tests/database";

function likeCount(html: string) {
	return html.match(/aria-pressed="(true|false)">[\s\S]*?<span class="tabular-nums">(\d+)<\/span>/)?.slice(1);
}

describe("like and unlike actions", () => {
	it("like a review once, however often the form is sent, and unlike it again", async () => {
		const { client, db } = createTestDatabase("like-unlike");
		const ada = insertUser(client, "ada");
		const bob = insertUser(client, "bob");
		const cleo = insertUser(client, "cleo");
		const review = insertReview(client, bob.id, insertRestaurant(client, "Bosporus Grill", { status: "approved" }).id, 8);
		const adaSession = await signIn(db, ada.id);
		const like = (session: Awaited<ReturnType<typeof signIn>>) =>
			server.reviews.like.call(actionContext(db, session), form({ reviewId: review.id }));

		expect((await like(adaSession)).error).toBeUndefined();
		await like(adaSession);
		await like(await signIn(db, cleo.id));

		expect(likeCount((await renderPage(FeedPage, { db, session: adaSession }, "/?feed=everyone")).html)).toEqual(["true", "2"]);

		const unliked = await server.reviews.unlike.call(actionContext(db, adaSession), form({ reviewId: review.id }));

		expect(unliked.error).toBeUndefined();
		expect(likeCount((await renderPage(FeedPage, { db, session: adaSession }, "/?feed=everyone")).html)).toEqual(["false", "1"]);
		expect(client.query.reviews.findFirst({ where: { id: review.id } }).sync()?.likeCount).toBe(1);
	});

	it("do not let a user like their own review", async () => {
		const { client, db } = createTestDatabase("like-own");
		const ada = insertUser(client, "ada");
		const review = insertReview(client, ada.id, insertRestaurant(client, "Bosporus Grill", { status: "approved" }).id, 8);

		const result = await server.reviews.like.call(actionContext(db, await signIn(db, ada.id)), form({ reviewId: review.id }));

		expect(result.error?.code).toBe("FORBIDDEN");
		expect(client.query.likes.findMany().sync()).toEqual([]);
	});

	it("do not find a review that is no longer public", async () => {
		const { client, db } = createTestDatabase("like-hidden");
		const ada = insertUser(client, "ada");
		const bob = insertUser(client, "bob");
		const grill = insertRestaurant(client, "Bosporus Grill", { status: "approved" });
		const day = 24 * 60 * 60 * 1000;
		const oldest = insertReview(client, bob.id, grill.id, 8, new Date(Date.now() - 4 * day));
		for (const age of [3, 2, 1]) {
			insertReview(client, bob.id, grill.id, 8, new Date(Date.now() - age * day));
		}

		const result = await server.reviews.like.call(actionContext(db, await signIn(db, ada.id)), form({ reviewId: oldest.id }));

		expect(result.error?.code).toBe("NOT_FOUND");
		expect(client.query.likes.findMany().sync()).toEqual([]);
	});
});
