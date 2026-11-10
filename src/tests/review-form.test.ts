import { describe, expect, it } from "vitest";
import NewReviewPage from "@src/pages/reviews/new.astro";
import EditReviewPage from "@src/pages/reviews/[id]/edit.astro";
import type { ActionOutcome } from "@src/actions/outcome";
import { renderPage } from "@src/tests/container";
import { pictureFile } from "@src/tests/pictures";
import { createTestDatabase, insertRestaurant, insertUser, signIn, writeReview } from "@src/tests/database";

// The rating group of a page, and its radio buttons with the rating and the name each one reads out.
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
	it("asks for a rating with five stars, chosen half a star at a time from 1 star, and nothing chosen", async () => {
		const { response, html } = await newReviewPage();
		const { group, options } = ratingIn(html);

		expect(response.status).toBe(200);
		expect(html).not.toContain("<select");
		expect(group).toMatch(/role="radiogroup" aria-labelledby="rating-label"/);
		expect(html).toMatch(/<p class="field-label" id="rating-label">\s*Rating\s*<\/p>/);
		expect(options.map(({ rating }) => rating)).toEqual([2, 3, 4, 5, 6, 7, 8, 9, 10]);
		// The first star has one rating, so it is one target. Every other star has a rating for each half.
		expect(options.map(({ part }) => part)).toEqual(["whole", "start", "end", "start", "end", "start", "end", "start", "end"]);
		expect(options.at(0)?.name).toBe("1 out of 5 stars");
		expect(options.at(1)?.name).toBe("1.5 out of 5 stars");
		expect(options.at(-1)?.name).toBe("5 out of 5 stars");
		expect(options.every(({ checked, required }) => !checked && required)).toBe(true);
	});

	it("gives the review the whole width of the form, with the question it answers inside the box", async () => {
		const { html } = await newReviewPage();

		expect(html).toMatch(/<div class="field-stack space-y-2"><div><label class="field-label" for="description">\s*Review\s*<\/label>/);
		expect(html).toMatch(/<textarea[^>]*placeholder="What was good, and what was not\?"/);
		expect(html).not.toContain('id="description-description"');
		expect(html.match(/<textarea[^>]*>/)?.[0].match(/\sname=/g)).toHaveLength(1);
	});

	it("names the pictures above their field, like the rating and the review, and tells how to add them inside it", async () => {
		const { html } = await newReviewPage();
		const input = html.match(/<input[^>]*type="file"[^>]*>/)?.[0] ?? "";

		expect(html).toMatch(/<div class="field-stack space-y-2"><label class="field-label" for="pictures">Pictures<\/label>/);
		expect(html).toMatch(/<p id="pictures-prompt" class="dropzone-label">Choose up to 4 pictures<\/p>/);
		expect(html).toMatch(/<p id="pictures-description" class="dropzone-description">Up to 10 MB each.<\/p>/);
		expect(input).toContain('aria-describedby="pictures-prompt pictures-description"');
	});

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

describe("the form to edit a review", () => {
	it("removes a picture with the button on it, in a form of its own, so the new pictures chosen are not sent with it", async () => {
		const { client, db } = createTestDatabase();
		const ada = insertUser(client, "ada");
		const grill = insertRestaurant(client, "Grill", { status: "approved" });
		const id = await writeReview(db, ada.id, grill.id, 7, [await pictureFile(), await pictureFile()]);
		const pictureIds = (await db.reviews.findById(id, ada.id))?.pictures.map((picture) => picture.id) ?? [];

		const { html } = await renderPage(EditReviewPage, { db, session: await signIn(db, ada.id) }, `/reviews/${id}/edit`, { id: String(id) });
		const buttons = [...html.matchAll(/<button class="picture-remove"([^>]*)>/g)].map(([, attributes]) => attributes);
		const removeForm = html.match(/<form id="remove-picture"[^>]*>[\s\S]*?<\/form>/)?.[0] ?? "";

		expect(buttons).toHaveLength(2);
		buttons.forEach((attributes, i) => {
			expect(attributes).toContain('type="submit" form="remove-picture" name="pictureId"');
			expect(attributes).toContain(`value="${pictureIds[i]}"`);
			expect(attributes).toContain(`aria-label="Remove picture ${i + 1}"`);
		});
		expect(removeForm).toContain('action="?_action=reviews.removePicture"');
		expect(removeForm).toContain(`name="reviewId" value="${id}"`);
		expect(html).not.toContain("removePictureIds");
		expect(html).toMatch(/<label class="field-label" for="pictures">Add pictures<\/label>/);
	});

	it("puts the button to delete the review beside the one to save it, and its dialog outside the form", async () => {
		const { client, db } = createTestDatabase();
		const ada = insertUser(client, "ada");
		const grill = insertRestaurant(client, "Grill", { status: "approved" });
		const id = await writeReview(db, ada.id, grill.id, 7);

		const { html } = await renderPage(EditReviewPage, { db, session: await signIn(db, ada.id) }, `/reviews/${id}/edit`, { id: String(id) });
		const footer = html.match(/<div class="settings-card-footer[^"]*">[\s\S]*?<\/div>/)?.[0] ?? "";
		const reviewForm = html.match(/<form[^>]*action="\?_action=reviews.update"[\s\S]*?<\/form>/)?.[0] ?? "";

		expect(footer).toMatch(new RegExp(`commandfor="delete-review-${id}" command="show-modal"[\\s\\S]*Save review`));
		expect(reviewForm).not.toContain("<dialog");
		expect(html).toMatch(new RegExp(`<dialog id="delete-review-${id}"[\\s\\S]*action="\\?_action=reviews.delete"`));
		expect(html).not.toContain("Danger zone");
		// A review without pictures has nothing to remove.
		expect(html).not.toContain('id="remove-picture"');
	});

	it("starts with the rating the review has", async () => {
		const { client, db } = createTestDatabase();
		const ada = insertUser(client, "ada");
		const grill = insertRestaurant(client, "Grill", { status: "approved" });
		const id = await writeReview(db, ada.id, grill.id, 7);

		const { html } = await renderPage(EditReviewPage, { db, session: await signIn(db, ada.id) }, `/reviews/${id}/edit`, { id: String(id) });

		expect(ratingIn(html).options.filter(({ checked }) => checked).map(({ rating }) => rating)).toEqual([7]);
	});
});
