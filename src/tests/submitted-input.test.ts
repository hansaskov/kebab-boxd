import { describe, expect, it } from "vitest";
import { server } from "@src/actions/index";
import { readSubmittedInput } from "@src/actions/submitted-input";
import SettingsPage from "@src/pages/[username]/settings.astro";
import SuggestPage from "@src/pages/restaurants/suggest.astro";
import EditReviewPage from "@src/pages/reviews/[id]/edit.astro";
import NewReviewPage from "@src/pages/reviews/new.astro";
import { actionContext, form, withActionResult } from "@src/tests/actions";
import { decode, renderPage } from "@src/tests/container";
import { createTestDatabase, insertRestaurant, insertUser, signIn } from "@src/tests/database";
import { pictureFile, textFile } from "@src/tests/pictures";

describe("a form whose action failed", () => {
	it("keeps the text fields of the submission and never the files", async () => {
		const submission = form({ restaurantId: 1, description: "Crispy", pictures: [await pictureFile(), await pictureFile()] });
		submission.append("_astroAction", "reviews.create");
		const request = new Request("http://localhost/reviews/new?_action=reviews.create", { method: "POST", body: submission });

		expect(await readSubmittedInput(request)).toEqual([
			["restaurantId", "1"],
			["description", "Crispy"],
		]);
	});

	it("shows the settings as the user typed them when the username is taken", async () => {
		const { client, db } = createTestDatabase("submitted-settings");
		const ada = insertUser(client, "ada");
		insertUser(client, "bob");
		const session = await signIn(db, ada.id);
		const typed = form({ currentUsername: "ada", fullname: "Ada Lovelace", username: "bob", pronoun: "She / her", bio: "Döner at dawn." });

		const result = await server.updateSettings.call(actionContext(db, session), typed);
		const locals = withActionResult({ db, session }, "updateSettings", result, typed);
		const html = decode((await renderPage(SettingsPage, locals, "/ada/settings", { username: "ada" })).html);

		expect(result.error?.code).toBe("CONFLICT");
		expect(html).toContain('value="Ada Lovelace"');
		expect(html).toMatch(/name="username"[^>]*value="bob"|value="bob"[^>]*name="username"/);
		expect(html).toContain('<option value="She / her" selected>');
		expect(html).toContain(">Döner at dawn.</textarea>");
	});

	it("shows a suggested link as the user typed it when it is not a Google Maps link", async () => {
		const { client, db } = createTestDatabase("submitted-suggestion");
		const ada = insertUser(client, "ada");
		const session = await signIn(db, ada.id);
		const typed = form({ link: "https://www.openstreetmap.org/node/341654817" });

		const result = await server.restaurants.suggest.call(actionContext(db, session), typed);
		const locals = withActionResult({ db, session }, "restaurants.suggest", result, typed);
		const html = decode((await renderPage(SuggestPage, locals, "/restaurants/suggest")).html);

		expect(result.error?.code).toBe("BAD_REQUEST");
		expect(html).toContain('value="https://www.openstreetmap.org/node/341654817"');
		expect(html).toContain("Paste the link Google Maps gives you when you share the restaurant.");
	});

	it("keeps the rating and the text of a review when a picture is refused, for a new review and an edited one", async () => {
		const { client, db } = createTestDatabase("submitted-review");
		const ada = insertUser(client, "ada");
		const grill = insertRestaurant(client, "Bosporus Grill", { status: "approved" });
		const session = await signIn(db, ada.id);
		const typed = form({ restaurantId: grill.id, rating: 7, description: "Long story about garlic sauce.", pictures: [textFile()] });

		const created = await server.reviews.create.call(actionContext(db, session), typed);
		const newPage = await renderPage(
			NewReviewPage,
			withActionResult({ db, session }, "reviews.create", created, typed),
			`/reviews/new?restaurant=${grill.id}`,
		);

		expect(created.error?.code).toBe("BAD_REQUEST");
		expect(newPage.html).toContain('<option value="7" selected>');
		expect(newPage.html).toContain(">Long story about garlic sauce.</textarea>");

		const review = await db.mutations.reviews.create(ada.id, grill.id, { rating: 4, description: "Short." }, [await pictureFile()]);
		if (typeof review !== "object") throw new Error("The review was not created.");
		const pictureId = (await db.queries.reviews.findById(review.id, ada.id))!.pictures[0]!.id;
		const edited = form({ reviewId: review.id, rating: 9, description: "Changed my mind.", removePictureIds: [pictureId], pictures: [textFile()] });
		const updated = await server.reviews.update.call(actionContext(db, session), edited);
		const editPage = await renderPage(
			EditReviewPage,
			withActionResult({ db, session }, "reviews.update", updated, edited),
			`/reviews/${review.id}/edit`,
			{ id: String(review.id) },
		);

		expect(updated.error?.code).toBe("BAD_REQUEST");
		expect(editPage.html).toContain('<option value="9" selected>');
		expect(editPage.html).toContain(">Changed my mind.</textarea>");
		expect(editPage.html).toMatch(new RegExp(`value="${pictureId}" checked`));
	});

	it("does not fill in another form on the page", async () => {
		const { client, db } = createTestDatabase("submitted-other-form");
		const ada = insertUser(client, "ada");
		const session = await signIn(db, ada.id);
		const typed = form({ currentUsername: "ada", location: "95, 10" });

		const result = await server.updateLocation.call(actionContext(db, session), typed);
		const html = (await renderPage(SettingsPage, withActionResult({ db, session }, "updateLocation", result, typed), "/ada/settings", { username: "ada" })).html;

		expect(html).toContain('value="95, 10"');
		expect(html).toContain('value="ada user"');
	});
});
