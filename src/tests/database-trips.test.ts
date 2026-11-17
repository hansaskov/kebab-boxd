import { readdirSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import type { DatabaseRequest } from "@src/db/remote";
import AdminPage from "@src/pages/admin/index.astro";
import AdminCitiesPage from "@src/pages/admin/cities/index.astro";
import AdminCitySearchPage from "@src/pages/admin/cities/searches/[id].astro";
import AdminRestaurantsPage from "@src/pages/admin/restaurants/index.astro";
import AdminUsersPage from "@src/pages/admin/users/index.astro";
import AdminUserPage from "@src/pages/admin/users/[username].astro";
import ExplorePage from "@src/pages/explore.astro";
import FeedPage from "@src/pages/feed.astro";
import LandingPage from "@src/pages/index.astro";
import LoginPage from "@src/pages/login.astro";
import NotificationsPage from "@src/pages/notifications.astro";
import PrivacyPage from "@src/pages/privacy.astro";
import RestaurantPage from "@src/pages/restaurants/[id].astro";
import SuggestPage from "@src/pages/restaurants/suggest.astro";
import NewReviewPage from "@src/pages/reviews/new.astro";
import ReviewPage from "@src/pages/reviews/[id]/index.astro";
import EditReviewPage from "@src/pages/reviews/[id]/edit.astro";
import SearchPage from "@src/pages/search.astro";
import ProfilePage from "@src/pages/[username]/profile.astro";
import SettingsPage from "@src/pages/[username]/settings/index.astro";
import DataSettingsPage from "@src/pages/[username]/settings/data.astro";
import LocationSettingsPage from "@src/pages/[username]/settings/location.astro";
import NotificationSettingsPage from "@src/pages/[username]/settings/notifications.astro";
import ProfileSettingsPage from "@src/pages/[username]/settings/profile.astro";
import SecuritySettingsPage from "@src/pages/[username]/settings/security.astro";
import SessionPage from "@src/pages/[username]/settings/sessions/[sessionId].astro";
import { loadSampleCityList } from "@src/tests/cities";
import { renderPage } from "@src/tests/container";
import { createTestDatabase, insertRestaurant, insertUser, signIn, writeReview } from "@src/tests/database";

async function setUp() {
	const { client, db } = createTestDatabase();
	const admin = insertUser(client, "root_admin", "admin");
	const ada = insertUser(client, "ada");
	const bob = insertUser(client, "bob");
	const cleo = insertUser(client, "cleo");
	await db.users.setPrivacy(cleo.id, cleo.username, true);
	await db.follows.follow(bob.id, ada.username);
	await db.follows.follow(bob.id, cleo.username);
	await db.follows.follow(ada.id, bob.username);
	const grill = insertRestaurant(client, "Bosporus Grill", { status: "approved" });
	insertRestaurant(client, "Mangal Express", { suggestedBy: bob.id });
	const reviewId = await writeReview(db, ada.id, grill.id, 8);
	await db.reviews.like(bob.id, reviewId);
	await db.collections.add(bob.id, grill.id, "favorites");
	await loadSampleCityList(db, admin.id);
	const [odense] = await db.cities.search("odense", 1);
	const search = await db.citySearches.start(admin.id, odense!.id, odense!.name);
	if (!("id" in search)) throw new Error(`The city search was refused: ${search.problem}.`);
	const sessions = { admin: await signIn(db, admin.id), ada: await signIn(db, ada.id), bob: await signIn(db, bob.id), cleo: await signIn(db, cleo.id) };
	return { db, sessions, grill, reviewId, citySearchId: search.id };
}

type Fixture = Awaited<ReturnType<typeof setUp>>;
type Page = Parameters<typeof renderPage>[0];

interface PageCase {
	page: Page;
	path: string;
	params?: Record<string, string>;
}

function fill(text: string, { grill, reviewId, citySearchId, sessions }: Fixture) {
	const values: Record<string, string> = { restaurant: String(grill.id), review: String(reviewId), search: String(citySearchId), session: sessions.bob.id };
	return text.replaceAll(/\{(\w+)\}/g, (_, name: string) => values[name]!);
}

const at = (page: Page, path: string, params: Record<string, string> = {}): PageCase => ({ page, path, params });
const profileOf = (username: string, query = "") => at(ProfilePage, `/${username}/profile${query}`, { username });
const settingsOf = (page: Page, section: string) => at(page, `/bob/settings${section}`, { username: "bob" });

const pagesOf: Record<"visitor" | keyof Fixture["sessions"], PageCase[]> = {
	visitor: [
		at(LandingPage, "/"),
		at(FeedPage, "/feed"),
		at(ExplorePage, "/explore"),
		at(ExplorePage, "/explore?lat=55.4&lng=10.39&zoom=13"),
		at(ExplorePage, "/explore?q=odense"),
		at(ExplorePage, "/explore?q=odense&lucky="),
		at(ExplorePage, "/explore?lucky="),
		at(SearchPage, "/search"),
		at(SearchPage, "/search?q=grill"),
		at(SearchPage, "/search?q=odense"),
		at(SearchPage, "/search?q=odense&type=cities"),
		at(RestaurantPage, "/restaurants/{restaurant}", { id: "{restaurant}" }),
		at(ReviewPage, "/reviews/{review}", { id: "{review}" }),
		profileOf("ada"),
		profileOf("ada", "?tab=followers"),
		profileOf("cleo"),
		at(PrivacyPage, "/privacy"),
		at(LoginPage, "/login"),
	],
	bob: [
		at(FeedPage, "/feed"),
		at(FeedPage, "/feed?feed=everyone"),
		at(ExplorePage, "/explore"),
		at(ExplorePage, "/explore?q=odense"),
		at(SearchPage, "/search?q=grill"),
		at(SearchPage, "/search?q=ada&type=people"),
		at(RestaurantPage, "/restaurants/{restaurant}", { id: "{restaurant}" }),
		at(ReviewPage, "/reviews/{review}", { id: "{review}" }),
		profileOf("bob"),
		profileOf("bob", "?tab=favorites"),
		profileOf("bob", "?tab=bucket-list"),
		profileOf("bob", "?tab=following"),
		profileOf("ada"),
		profileOf("cleo"),
		at(NotificationsPage, "/notifications"),
		at(NewReviewPage, "/reviews/new?restaurant={restaurant}"),
		at(SuggestPage, "/restaurants/suggest"),
		settingsOf(SettingsPage, ""),
		settingsOf(ProfileSettingsPage, "/profile"),
		settingsOf(LocationSettingsPage, "/location"),
		settingsOf(NotificationSettingsPage, "/notifications"),
		settingsOf(SecuritySettingsPage, "/security"),
		settingsOf(DataSettingsPage, "/data"),
		at(SessionPage, "/bob/settings/sessions/{session}", { username: "bob", sessionId: "{session}" }),
	],
	ada: [at(EditReviewPage, "/reviews/{review}/edit", { id: "{review}" })],
	cleo: [profileOf("cleo", "?tab=requests"), profileOf("cleo", "?tab=followers")],
	admin: [
		at(AdminPage, "/admin"),
		at(AdminUsersPage, "/admin/users"),
		at(AdminUserPage, "/admin/users/ada", { username: "ada" }),
		at(AdminRestaurantsPage, "/admin/restaurants"),
		at(AdminRestaurantsPage, "/admin/restaurants?search={search}"),
		at(AdminCitiesPage, "/admin/cities"),
		at(AdminCitiesPage, "/admin/cities?q=odense"),
		at(AdminCitySearchPage, "/admin/cities/searches/{search}", { id: "{search}" }),
	],
};

const cases = Object.entries(pagesOf).flatMap(([who, pages]) => pages.map((page) => [`${who} ${page.path}`, { who, ...page }] as const));

const root = fileURLToPath(new URL("../..", import.meta.url));
const errorPage = /^src\/pages\/\d{3}\.astro$/;

function pageFiles() {
	return readdirSync(join(root, "src", "pages"), { recursive: true, encoding: "utf8" })
		.filter((path) => path.endsWith(".astro"))
		.map((path) => join("src", "pages", path))
		.filter((path) => !errorPage.test(path));
}

function fileOf(page: Page) {
	return relative(root, (page as unknown as { moduleId: string }).moduleId);
}

describe("every page", () => {
	it("is among the pages whose trips are counted", () => {
		const counted = new Set(Object.values(pagesOf).flatMap((pages) => pages.map(({ page }) => fileOf(page))));

		expect(pageFiles().filter((path) => !counted.has(path))).toEqual([]);
	});

	it.each(cases)("waits for the database once, with its session: %s", async (_name, { who, page, path, params }) => {
		const fixture = await setUp();
		const trips: DatabaseRequest[] = [];
		const session = who === "visitor" ? null : fixture.sessions[who as keyof Fixture["sessions"]];
		const filledParams = Object.fromEntries(Object.entries(params ?? {}).map(([name, value]) => [name, fill(value, fixture)]));

		const { response } = await renderPage(page, { db: fixture.db, session, onTrip: (trip) => trips.push(trip) }, fill(path, fixture), filledParams);

		const calls = trips.map((trip) => trip.calls.map(({ area, method }) => `${area}.${method}`));
		expect(response.status).toBeLessThan(400);
		expect(trips.length, `the trips: ${JSON.stringify(calls)}`).toBeLessThanOrEqual(1);
		if (session) expect(trips[0]?.session?.token).toBe(session.token);
	});
});
