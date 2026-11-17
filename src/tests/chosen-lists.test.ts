import { describe, expect, it } from "vitest";
import ProfilePage from "@src/pages/[username]/profile.astro";
import SearchPage from "@src/pages/search.astro";
import { renderPage, type TestLocals } from "@src/tests/container";
import { createTestDatabase, insertRestaurant, insertUser, signIn, writeReview } from "@src/tests/database";

async function adaWithEveryList() {
	const { client, db } = createTestDatabase();
	const ada = insertUser(client, "ada");
	const bo = insertUser(client, "bo");
	const cy = insertUser(client, "cy");
	const grill = insertRestaurant(client, "Bosporus Grill", { status: "approved" });
	const doner = insertRestaurant(client, "Döner Palace", { status: "approved" });
	await db.reviews.create(ada.id, grill.id, { rating: 8, description: "Crisp and warm." }, []);
	await db.collections.add(ada.id, grill.id, "favorites");
	await db.collections.add(ada.id, doner.id, "bucketList");
	await db.follows.follow(bo.id, "ada");
	await db.follows.follow(ada.id, "cy");
	return { client, db, ada, bo, cy };
}

async function profileTab(locals: TestLocals, username: string, tab: string | undefined) {
	return renderPage(ProfilePage, locals, `/${username}/profile${tab ? `?tab=${tab}` : ""}`, { username });
}

describe("The lists of a Profile", () => {
	it("show the list of the chosen tab and none of the others", async () => {
		const { db, ada } = await adaWithEveryList();
		const locals = { db, session: await signIn(db, ada.id) };
		const shows = async (tab: string | undefined) => {
			const { html } = await profileTab(locals, "ada", tab);
			return {
				review: html.includes("Crisp and warm."),
				favorite: html.includes("Bosporus Grill"),
				bucketList: html.includes("Döner Palace"),
				follower: html.includes('href="/bo/profile"'),
				following: html.includes('href="/cy/profile"'),
			};
		};
		const none = { review: false, favorite: false, bucketList: false, follower: false, following: false };

		expect(await shows(undefined)).toEqual({ ...none, review: true, favorite: true });
		expect(await shows("favorites")).toEqual({ ...none, favorite: true });
		expect(await shows("bucket-list")).toEqual({ ...none, bucketList: true });
		expect(await shows("followers")).toEqual({ ...none, follower: true });
		expect(await shows("following")).toEqual({ ...none, following: true });
	});

	it("give each favorite and bucket list item the way to remove it from its own list on the own Profile", async () => {
		const { db, ada } = await adaWithEveryList();
		const locals = { db, session: await signIn(db, ada.id) };

		expect((await profileTab(locals, "ada", "favorites")).html).toContain("Remove from favorites");
		expect((await profileTab(locals, "ada", "bucket-list")).html).toContain("Remove from bucket list");
		expect((await profileTab({ db, session: null }, "ada", "favorites")).html).not.toContain("Remove from favorites");
	});

	it("lead a User without a Review to find a Restaurant to review", async () => {
		const { client, db } = createTestDatabase();
		const ada = insertUser(client, "ada");

		const { html } = await profileTab({ db, session: await signIn(db, ada.id) }, "ada", undefined);

		expect(html).toContain("You have not written a review yet.");
		expect(html).toContain('href="/search?type=restaurants"');
	});

	it("show the FollowRequests only to the User they wait for, and send anyone else back to the Profile", async () => {
		const { db, ada, cy } = await adaWithEveryList();
		await db.users.setPrivacy(ada.id, "ada", true);
		await db.follows.follow(cy.id, "ada");

		const own = await profileTab({ db, session: await signIn(db, ada.id) }, "ada", "requests");
		const other = await profileTab({ db, session: await signIn(db, cy.id) }, "ada", "requests");
		const visitor = await profileTab({ db, session: null }, "ada", "requests");

		expect(own.response.status).toBe(200);
		expect(own.html).toContain('href="/cy/profile"');
		expect([other.response.status, other.response.headers.get("location")]).toEqual([302, "/ada/profile"]);
		expect([visitor.response.status, visitor.response.headers.get("location")]).toEqual([302, "/ada/profile"]);
	});

	it("show the Reviews of a PrivateProfile to its Followers, and tell anyone else that only they see them", async () => {
		const { db, ada, bo, cy } = await adaWithEveryList();
		await db.users.setPrivacy(ada.id, "ada", true);

		const follower = await profileTab({ db, session: await signIn(db, bo.id) }, "ada", undefined);
		const stranger = await profileTab({ db, session: await signIn(db, cy.id) }, "ada", undefined);

		expect([follower.html.includes("Crisp and warm."), follower.html.includes("Only the followers of")]).toEqual([true, false]);
		expect([stranger.html.includes("Crisp and warm."), stranger.html.includes("Only the followers of")]).toEqual([false, true]);
	});
});

describe("The results of a search", () => {
	async function searchWorld() {
		const { client, db } = createTestDatabase();
		const ada = insertUser(client, "ada");
		const grill = insertRestaurant(client, "Bosporus Grill", { status: "approved" });
		await writeReview(db, ada.id, grill.id, 8);
		insertRestaurant(client, "Bosporus Express", { status: "approved" });
		return { db, locals: { db, session: null } };
	}

	const search = (locals: TestLocals, query: string) => renderPage(SearchPage, locals, `/search?${query}`);

	it("show a preview of Restaurants and people under All, and only the chosen kind under its tab", async () => {
		const { locals } = await searchWorld();
		const kinds = (html: string) => ({
			restaurants: html.includes("Bosporus Grill"),
			people: html.includes('href="/ada/profile"'),
			cityHint: html.includes("Type the name of a city."),
		});

		expect(kinds((await search(locals, "")).html)).toEqual({ restaurants: true, people: true, cityHint: false });
		expect(kinds((await search(locals, "type=restaurants")).html)).toEqual({ restaurants: true, people: false, cityHint: false });
		expect(kinds((await search(locals, "type=people")).html)).toEqual({ restaurants: false, people: true, cityHint: false });
		expect(kinds((await search(locals, "type=cities")).html)).toEqual({ restaurants: false, people: false, cityHint: true });
	});

	it("sorts the Restaurants as their tab asks, and the preview under All always as the first sort", async () => {
		const { locals } = await searchWorld();
		const order = (html: string) => [html.indexOf("Bosporus Grill"), html.indexOf("Bosporus Express")];
		const firstOf = (html: string) => {
			const [grill = -1, express = -1] = order(html);
			return grill < express ? "Bosporus Grill" : "Bosporus Express";
		};

		expect(firstOf((await search(locals, "type=restaurants")).html)).toBe("Bosporus Grill");
		expect(firstOf((await search(locals, "type=restaurants&sort=newest")).html)).toBe("Bosporus Express");
		expect(firstOf((await search(locals, "sort=newest")).html)).toBe("Bosporus Grill");
	});
});
