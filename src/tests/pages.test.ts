import { describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { createSession } from "@src/auth/session";
import * as s from "@src/db/schema";
import AdminPage from "@src/pages/admin/index.astro";
import AdminCitiesPage from "@src/pages/admin/cities/index.astro";
import AdminCitySearchPage from "@src/pages/admin/cities/searches/[id].astro";
import NotificationsPage from "@src/pages/notifications.astro";
import AdminRestaurantsPage from "@src/pages/admin/restaurants/index.astro";
import AdminUsersPage from "@src/pages/admin/users/index.astro";
import AdminUserPage from "@src/pages/admin/users/[username].astro";
import LandingPage from "@src/pages/index.astro";
import LoginPage from "@src/pages/login.astro";
import ProfilePage from "@src/pages/[username]/profile.astro";
import SessionPage from "@src/pages/[username]/settings/sessions/[sessionId].astro";
import SettingsPage from "@src/pages/[username]/settings/index.astro";
import LocationSettingsPage from "@src/pages/[username]/settings/location.astro";
import RestaurantPage from "@src/pages/restaurants/[id].astro";
import SearchPage from "@src/pages/search.astro";
import * as ExportEndpoint from "@src/pages/api/users/[username]/export";
import { loadSampleCityList } from "@src/tests/cities";
import { dialogIn, renderPage, requestEndpoint } from "@src/tests/container";
import { createTestDatabase, insertRestaurant, insertReview, insertUser, signIn } from "@src/tests/database";

describe("pages", () => {
	it("show a Visitor what Kebab Boxd is, and ask them to log in on the page to get started, then send them to their Feed", async () => {
		const { db } = createTestDatabase();

		const { response, html } = await renderPage(LandingPage, { db, session: null }, "/");
		const dialog = dialogIn(html, "login-get-started");

		expect(response.status).toBe(200);
		expect(html.match(/commandfor="login-get-started" command="show-modal"/g)).toHaveLength(2);
		expect(dialog).toContain("Log in to Kebab Boxd");
		expect(dialog).toContain('href="/api/google"');
		expect(dialog).not.toMatch(/^<dialog\b[^>]*\sopen\b/);
		expect(html).toContain('rel="preload" href="/fonts/google-sans-medium-latin.woff2"');
	});

	it("tell a Visitor on the landing page that their account is deleted", async () => {
		const { db } = createTestDatabase();

		const { html } = await renderPage(LandingPage, { db, session: null }, "/?notice=account-deleted");

		expect(html).toContain("Account deleted");
	});

	it("invite a visitor who is not signed in to sign in with Google", async () => {
		const { db } = createTestDatabase();

		const { response, html } = await renderPage(LoginPage, { db, session: null }, "/login");

		expect(response.status).toBe(200);
		expect(html).toMatch(/<a class="btn-google" href="\/api\/google">\s*<img src="\/google-g.svg" alt="">\s*Sign in with Google\s*<\/a>/);
		expect(html).toContain('rel="preload" href="/fonts/google-sans-medium-latin.woff2"');
		expect(html).not.toContain("<dialog");
	});

	it.each([
		["notifications", "status", "Log in to see your notifications"],
		["logged-out", "alert", "You are logged out"],
		["banned", "alert", "Account banned"],
	])("tell a visitor who is sent to the login page for %s why, in a toast, and keep the page to come back to", async (reason, role, title) => {
		const { db } = createTestDatabase();

		const { html } = await renderPage(LoginPage, { db, session: null }, `/login?reason=${reason}&next=%2Fnotifications`);

		expect(html).toMatch(new RegExp(`role="${role}"[\\s\\S]*?>${title}</p>`));
		expect(html).toContain('href="/api/google?next=%2Fnotifications"');
		expect(html).not.toContain("<dialog");
	});

	it("show no toast for a reason the login page does not know", async () => {
		const { db } = createTestDatabase();

		const { html } = await renderPage(LoginPage, { db, session: null }, "/login?reason=%3Cscript%3E");

		expect(html).not.toMatch(/role="(status|alert)"/);
	});

	it.each([
		["landing", LandingPage, "/"],
		["login", LoginPage, "/login"],
	] as const)("send a signed-in User from the %s page to their Feed", async (_name, page, path) => {
		const { client, db } = createTestDatabase();
		const ada = insertUser(client, "ada");

		const { response } = await renderPage(page, { db, session: await signIn(db, ada.id) }, path);

		expect(response.status).toBe(302);
		expect(response.headers.get("Location")).toBe("/feed");
	});

	it.each([
		["/admin", AdminPage, {}],
		["/admin/restaurants", AdminRestaurantsPage, {}],
		["/admin/cities", AdminCitiesPage, {}],
		["/admin/cities/searches/1", AdminCitySearchPage, { id: "1" }],
		["/admin/users", AdminUsersPage, {}],
		["/admin/users/ada", AdminUserPage, { username: "ada" }],
	] as const)("forbid %s to a User who is not an Admin", async (path, page, params) => {
		const { client, db } = createTestDatabase();
		const ada = insertUser(client, "ada");

		const { response } = await renderPage(page, { db, session: await signIn(db, ada.id) }, path, params);

		expect(response.status).toBe(403);
	});

	it("find approved Restaurants and unbanned Users with one search", async () => {
		const { client, db } = createTestDatabase();
		const ada = insertUser(client, "ada");
		insertUser(client, "kebab_kim");
		const banned = insertUser(client, "kebab_banned");
		client.update(s.users).set({ bannedAt: new Date() }).where(eq(s.users.id, banned.id)).run();
		insertRestaurant(client, "Kebab Corner", { status: "approved" });
		insertRestaurant(client, "Kebab Pending");
		const session = await signIn(db, ada.id);

		const all = (await renderPage(SearchPage, { db, session }, "/search?q=kebab")).html;
		const restaurants = (await renderPage(SearchPage, { db, session }, "/search?q=kebab&type=restaurants")).html;
		const people = (await renderPage(SearchPage, { db, session }, "/search?q=kebab&type=people")).html;

		expect({
			all: [all.includes("Kebab Corner"), all.includes("@kebab_kim")],
			restaurants: [restaurants.includes("Kebab Corner"), restaurants.includes("@kebab_kim")],
			people: [people.includes("Kebab Corner"), people.includes("@kebab_kim")],
			hidden: [all.includes("Kebab Pending"), all.includes("@kebab_banned")],
		}).toEqual({
			all: [true, true],
			restaurants: [true, false],
			people: [false, true],
			hidden: [false, false],
		});
	});

	it("show unbanned Users when the search is empty", async () => {
		const { client, db } = createTestDatabase();
		const ada = insertUser(client, "ada");
		insertUser(client, "kebab_kim");
		const banned = insertUser(client, "kebab_banned");
		client.update(s.users).set({ bannedAt: new Date() }).where(eq(s.users.id, banned.id)).run();
		const session = await signIn(db, ada.id);

		const all = (await renderPage(SearchPage, { db, session }, "/search?q=")).html;
		const people = (await renderPage(SearchPage, { db, session }, "/search?type=people")).html;

		expect({
			all: [all.includes("@kebab_kim"), all.includes("@kebab_banned")],
			people: [people.includes("@kebab_kim"), people.includes("@kebab_banned")],
		}).toEqual({ all: [true, false], people: [true, false] });
	});

	it("show a pending Restaurant only to the User who suggested it and to Admins", async () => {
		const { client, db } = createTestDatabase();
		const admin = insertUser(client, "root_admin", "admin");
		const ada = insertUser(client, "ada");
		const bob = insertUser(client, "bob");
		const { id } = insertRestaurant(client, "Mangal Express", { suggestedBy: ada.id });
		const statusFor = async (userId: number) =>
			(await renderPage(RestaurantPage, { db, session: await signIn(db, userId) }, `/restaurants/${id}`, { id: String(id) })).response.status;

		expect({ suggester: await statusFor(ada.id), other: await statusFor(bob.id), admin: await statusFor(admin.id) }).toEqual({
			suggester: 200,
			other: 404,
			admin: 200,
		});
	});

	it("show the Profile of a banned User only to Admins", async () => {
		const { client, db } = createTestDatabase();
		const admin = insertUser(client, "root_admin", "admin");
		const ada = insertUser(client, "ada");
		const bob = insertUser(client, "bob");
		client.update(s.users).set({ bio: "Secret sauce" }).where(eq(s.users.id, bob.id)).run();
		insertReview(client, bob.id, insertRestaurant(client, "Bosporus Grill", { status: "approved" }).id, 9);
		await db.users.ban(admin.id, bob.username);
		const profileFor = async (userId: number) =>
			(await renderPage(ProfilePage, { db, session: await signIn(db, userId) }, "/bob/profile", { username: "bob" })).html;

		const asUser = await profileFor(ada.id);

		for (const data of [bob.fullname, "Secret sauce", "Bosporus Grill"]) expect(asUser).not.toContain(data);
		expect(await profileFor(admin.id)).toContain("Secret sauce");
	});

	it("show a User their hidden Reviews on their own Profile, and no one else", async () => {
		const { client, db } = createTestDatabase();
		const admin = insertUser(client, "root_admin", "admin");
		const ada = insertUser(client, "ada");
		const bob = insertUser(client, "bob");
		insertReview(client, bob.id, insertRestaurant(client, "Bosporus Grill", { status: "approved" }).id, 9);
		insertReview(client, bob.id, insertRestaurant(client, "Mangal Express").id, 4);
		const profileFor = async (userId: number) =>
			(await renderPage(ProfilePage, { db, session: await signIn(db, userId) }, "/bob/profile", { username: "bob" })).html;
		const shown = (html: string) => ["Bosporus Grill", "Mangal Express"].filter((name) => html.includes(name));

		expect({ author: shown(await profileFor(bob.id)), user: shown(await profileFor(ada.id)), admin: shown(await profileFor(admin.id)) }).toEqual({
			author: ["Bosporus Grill", "Mangal Express"],
			user: ["Bosporus Grill"],
			admin: ["Bosporus Grill"],
		});
	});

	it("invite a User with no Reviews to find a restaurant to review from their own Profile", async () => {
		const { client, db } = createTestDatabase();
		const ada = insertUser(client, "ada");
		const bob = insertUser(client, "bob");
		const profileFor = async (userId: number) =>
			(await renderPage(ProfilePage, { db, session: await signIn(db, userId) }, "/bob/profile", { username: "bob" })).html;

		expect(await profileFor(bob.id)).toContain('href="/search?type=restaurants"');
		expect(await profileFor(ada.id)).not.toContain('href="/search?type=restaurants"');
	});

	it("never show the devices or the data of another User", async () => {
		const { client, db } = createTestDatabase();
		const admin = insertUser(client, "root_admin", "admin");
		const ada = insertUser(client, "ada");
		const bob = insertUser(client, "bob");
		const bobSession = await createSession(db, bob.id);
		client.insert(s.history)
			.values({ sessionId: bobSession.id, requestedAt: new Date(), method: "GET", route: "/secret", path: "/secret", status: 200 })
			.run();
		const adaSession = await signIn(db, ada.id);
		const devicePage = (username: string) =>
			renderPage(SessionPage, { db, session: adaSession }, `/${username}/settings/sessions/${bobSession.id}`, { username, sessionId: bobSession.id });
		const exportBy = async (userId: number) =>
			requestEndpoint(ExportEndpoint, { db, session: await signIn(db, userId) }, "/api/users/bob/export", { username: "bob" });

		const underOwnName = await devicePage("ada");
		const underTheirName = await devicePage("bob");
		const exportedByAdmin = await exportBy(admin.id);

		expect(underOwnName.response.status).toBe(404);
		expect(underOwnName.html).not.toContain("/secret");
		expect(underTheirName.response.status).toBe(403);
		expect(underTheirName.html).not.toContain("/secret");
		expect(exportedByAdmin.status).toBe(403);
		expect(await exportedByAdmin.text()).not.toContain(bob.email);
	});

	it("let an Admin find a City, start a CitySearch for it, and review the Restaurants it found", async () => {
		const { client, db } = createTestDatabase();
		const admin = insertUser(client, "root_admin", "admin");
		const session = await signIn(db, admin.id);
		const empty = (await renderPage(AdminCitiesPage, { db, session }, "/admin/cities")).html;
		await loadSampleCityList(db, admin.id);
		const found = (await renderPage(AdminCitiesPage, { db, session }, "/admin/cities?q=pari")).html;
		const short = (await renderPage(AdminCitiesPage, { db, session }, "/admin/cities?q=p")).html;
		const started = await db.citySearches.start(admin.id, 2988507, "Paris");
		if ("problem" in started) throw new Error(`The search did not start: ${started.problem}.`);
		const searching = (await renderPage(AdminCitiesPage, { db, session }, "/admin/cities?q=pari")).html;
		const { id: restaurantId } = insertRestaurant(client, "Paris Kebab");
		client.update(s.restaurants).set({ citySearchId: started.id, osmId: "node/7" }).where(eq(s.restaurants.id, restaurantId)).run();
		insertRestaurant(client, "Odense Kebab");
		const review = (await renderPage(AdminRestaurantsPage, { db, session }, `/admin/restaurants?search=${started.id}`)).html;

		expect({
			empty: [empty.includes("No cities yet"), empty.includes('name="q"')],
			found: [found.includes("Île-de-France, France"), found.includes("Texas, United States"), found.split("Find restaurants").length - 1],
			short: [short.includes("Type at least two letters."), short.includes("No city starts with")],
			// A reload would wipe what the Admin types in the search form.
			searching: [
				searching.split("Find restaurants").length - 1,
				searching.includes("Searching"),
				searching.includes(`href="/admin/cities/searches/${started.id}"`),
				searching.includes('http-equiv="refresh"'),
			],
			review: [review.includes("Restaurants in Paris"), review.includes("Paris Kebab"), review.includes("Odense Kebab"), review.includes("https://www.openstreetmap.org/node/7")],
		}).toEqual({
			empty: [true, false],
			found: [true, true, 2],
			short: [true, false],
			searching: [1, true, true, false],
			review: [true, true, false, true],
		});
	});

	it("tell an Admin how many Restaurants their CitySearch found", async () => {
		const { client, db } = createTestDatabase();
		const admin = insertUser(client, "root_admin", "admin");
		await loadSampleCityList(db, admin.id);
		const started = await db.citySearches.start(admin.id, 2615876, "Odense");
		if ("problem" in started) throw new Error(`The search did not start: ${started.problem}.`);
		await db.citySearches.saveCandidates(started.id, {
			places: [{ osmId: "node/1", name: "Kebab Huset", latitude: 55.4, longitude: 10.39, address: { addressLine1: "Vestergade 1", postalCode: null, city: "Odense", country: "Denmark" } }],
			server: "overpass.example",
			failures: [],
		});
		const candidate = await db.citySearches.nextCandidate();
		await db.citySearches.addCandidate(candidate!.id, { addressLine1: "Vestergade 1", postalCode: null, city: "Odense", country: "Denmark" });

		const { html } = await renderPage(NotificationsPage, { db, session: await signIn(db, admin.id) }, "/notifications");

		expect(html).toContain("Found 1 new restaurant in <strong");
		expect(html).toContain(`href="/admin/restaurants?search=${started.id}"`);
	});

	it("lead an Admin to the log of their CitySearch when it found nothing or failed", async () => {
		const { client, db } = createTestDatabase();
		const admin = insertUser(client, "root_admin", "admin");
		await loadSampleCityList(db, admin.id);
		const empty = await db.citySearches.start(admin.id, 2615876, "Odense");
		const failed = await db.citySearches.start(admin.id, 2618425, "Copenhagen");
		if ("problem" in empty || "problem" in failed) throw new Error("The searches did not start.");
		await db.citySearches.saveCandidates(empty.id, { places: [], server: "overpass.example", failures: [] });
		for (let attempt = 0; attempt < 5; attempt++) {
			await db.citySearches.retrySearchLater(failed.id, new Date(), [{ server: "overpass-api.de", reason: "answered 521" }]);
		}

		const { html } = await renderPage(NotificationsPage, { db, session: await signIn(db, admin.id) }, "/notifications");

		expect(html).toContain(`href="/admin/cities/searches/${empty.id}"`);
		expect(html).toContain(`href="/admin/cities/searches/${failed.id}"`);
		expect(html).not.toContain("/admin/restaurants?search=");
	});

	it("show an Admin what a CitySearch did, refresh while it runs, and offer to try again once it failed", async () => {
		const { client, db } = createTestDatabase();
		const admin = insertUser(client, "root_admin", "admin");
		const session = await signIn(db, admin.id);
		await loadSampleCityList(db, admin.id);
		const started = await db.citySearches.start(admin.id, 2615876, "Odense");
		if ("problem" in started) throw new Error(`The search did not start: ${started.problem}.`);
		const page = async () => (await renderPage(AdminCitySearchPage, { db, session }, `/admin/cities/searches/${started.id}`, { id: String(started.id) })).html;
		const searching = await page();
		for (let attempt = 0; attempt < 5; attempt++) {
			await db.citySearches.retrySearchLater(started.id, new Date(), [{ server: "overpass-api.de", reason: "answered 521" }]);
		}
		const failed = await page();

		expect({
			searching: [searching.includes("Searching OpenStreetMap"), searching.includes('http-equiv="refresh"'), searching.includes("Try again now")],
			failed: [failed.includes("Failed"), failed.includes('http-equiv="refresh"'), failed.includes("Try again now"), failed.includes("overpass-api.de answered 521.")],
		}).toEqual({
			searching: [true, true, false],
			failed: [true, false, true, true],
		});
	});

	it("keep the location of a User from an Admin, who manages the rest of their settings", async () => {
		const { client, db } = createTestDatabase();
		const ada = insertUser(client, "ada");
		const admin = insertUser(client, "root_admin", "admin");
		await db.users.setLocation(ada.id, ada.username, { latitude: 55.4, longitude: 10.39 });
		const session = await signIn(db, admin.id);

		const location = await renderPage(LocationSettingsPage, { db, session }, "/ada/settings/location", { username: "ada" });
		const overview = (await renderPage(SettingsPage, { db, session }, "/ada/settings", { username: "ada" })).html;
		const change = await db.users.setLocation(admin.id, ada.username, null);

		expect({
			location: [location.response.status, location.html.includes("55.4")],
			overview: [overview.includes('href="/ada/settings/profile"'), overview.includes('href="/ada/settings/location"')],
			change,
		}).toEqual({
			location: [403, false],
			overview: [true, false],
			change: { problem: "forbidden", permission: "user:edit-location" },
		});
	});
});
