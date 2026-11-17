import { describe, expect, it } from "vitest";
import NewReviewPage from "@src/pages/reviews/new.astro";
import type { ActionOutcome } from "@src/actions/outcome";
import { renderPage } from "@src/tests/container";
import { createTestDatabase, insertRestaurant, insertUser, signIn } from "@src/tests/database";

function ratingIn(html: string) {
	const group = html.match(/<div class="star-rating"[\s\S]*?<\/div>/)?.[0] ?? "";
	const options = [...group.matchAll(/<label class="([^"]*)">\s*<input([^>]*)>\s*<span class="sr-only">([^<]*)<\/span>/g)].map(
		([, labelClass = "", input = "", name = ""]) => ({
			part: labelClass.match(/star-rating-(start|end|whole)/)?.[1],
			rating: Number(input.match(/value="(\d+)"/)?.[1]),
			checked: /\schecked\b/.test(input),
			required: /\srequired\b/.test(input),
			name,
		}),
	);
	return { group, options };
}

async function newReviewPage(actionOutcome?: ActionOutcome) {
	const { client, db } = createTestDatabase();
	const ada = insertUser(client, "ada");
	const grill = insertRestaurant(client, "Grill", { status: "approved" });
	const session = await signIn(db, ada.id);
	return renderPage(NewReviewPage, { db, session, actionOutcome }, `/reviews/new?restaurant=${grill.id}`);
}

describe("the form to review a restaurant", () => {
	it("keeps the rating and the review the user sent when the form failed, and says what was wrong with the rating", async () => {
		const { html } = await newReviewPage({
			name: "reviews.create",
			failure: {
				code: "BAD_REQUEST",
				message: "Failed to validate.",
				fields: { rating: ["Choose a rating."] },
				input: [["rating", "7"], ["description", "Crisp bread."]],
			},
		});
		const { group, options } = ratingIn(html);

		expect(options.filter(({ checked }) => checked).map(({ rating }) => rating)).toEqual([7]);
		expect(group).toMatch(/aria-describedby="rating-error" aria-invalid="true"/);
		expect(html).toMatch(/<p id="rating-error"[^>]*role="alert">Choose a rating.<\/p>/);
		expect(html).toMatch(/<textarea[^>]*>Crisp bread.<\/textarea>/);
	});
});
