import { describe, expect, it } from "vitest";
import { adminTabs } from "@src/data/admin-tabs";
import { settingsSections } from "@src/data/settings-sections";
import { settingsHref } from "@src/hrefs";
import LoginPage from "@src/pages/login.astro";
import SearchPage from "@src/pages/search.astro";
import SettingsPage from "@src/pages/[username]/settings/index.astro";
import ProfileSettingsPage from "@src/pages/[username]/settings/profile.astro";
import LocationSettingsPage from "@src/pages/[username]/settings/location.astro";
import DataSettingsPage from "@src/pages/[username]/settings/data.astro";
import { renderPage } from "@src/tests/container";
import { createTestDatabase, insertUser, signIn } from "@src/tests/database";

describe("the navigation", () => {
	it("leads a signed-in User to their account, and a Visitor to log in and back to the page they are on", async () => {
		const { client, db } = createTestDatabase();
		const ada = insertUser(client, "ada");
		const shows = (html: string) => ({
			navigation: html.includes('aria-label="Main"'),
			account: html.includes('popovertarget="account-menu"'),
			notifications: html.includes('href="/notifications"'),
			feed: html.includes('<a class="nav-link" href="/feed"'),
			login: /href="\/login\?next=%2Fsearch%3Fq%3Dkebab"[^>]*>[\s\S]*?Login<\/span>/.test(html),
		});

		const signedIn = (await renderPage(SearchPage, { db, session: await signIn(db, ada.id) }, "/search?q=kebab")).html;
		const visitor = (await renderPage(SearchPage, { db, session: null }, "/search?q=kebab")).html;
		const onSignIn = (await renderPage(LoginPage, { db, session: null }, "/login")).html;

		expect({ signedIn: shows(signedIn), visitor: shows(visitor), onSignIn: [shows(onSignIn).navigation, onSignIn.includes('href="/login')] }).toEqual({
			signedIn: { navigation: true, account: true, notifications: true, feed: true, login: false },
			visitor: { navigation: true, account: false, notifications: false, feed: true, login: true },
			onSignIn: [true, false],
		});
	});

	it("marks the page it is on and tells how many Notifications are unread", async () => {
		const { client, db } = createTestDatabase();
		const ada = insertUser(client, "ada");
		const bob = insertUser(client, "bob");
		await db.follows.follow(bob.id, ada.username);

		const { html } = await renderPage(SearchPage, { db, session: await signIn(db, ada.id) }, "/search");

		expect(html).toMatch(/<a class="nav-link" href="\/search" aria-current="page"/);
		expect(html).toContain(", 1 unread");
	});

	it("leads only an Admin to the admin console", async () => {
		const { client, db } = createTestDatabase();
		const admin = insertUser(client, "root_admin", "admin");
		const ada = insertUser(client, "ada");
		const navigationOf = async (userId: number) => (await renderPage(SearchPage, { db, session: await signIn(db, userId) }, "/search")).html;

		expect(await navigationOf(admin.id)).toContain('href="/admin"');
		expect(await navigationOf(ada.id)).not.toContain('href="/admin"');
	});

	it("marks the admin page that a page of the admin console is under", () => {
		const currentOf = (pathname: string) => adminTabs(pathname).filter((tab) => tab.current).map((tab) => tab.label);

		expect({
			overview: currentOf("/admin"),
			users: currentOf("/admin/users"),
			user: currentOf("/admin/users/ada"),
			restaurants: currentOf("/admin/restaurants"),
		}).toEqual({ overview: ["Overview"], users: ["Users"], user: ["Users"], restaurants: ["Restaurants"] });
	});
});

describe("the settings", () => {
	it("open on an overview, and give every section its own page", () => {
		expect([settingsHref("ada"), ...settingsSections.map((section) => settingsHref("ada", section))]).toEqual([
			"/ada/settings",
			"/ada/settings/profile",
			"/ada/settings/location",
			"/ada/settings/notifications",
			"/ada/settings/security",
			"/ada/settings/data",
		]);
	});

	it.each([
		["overview", SettingsPage, "/ada/settings"],
		["menu beside a section", ProfileSettingsPage, "/ada/settings/profile"],
	] as const)("list in the %s the sections a User may open of their own, and those an Admin may open of another", async (_, page, path) => {
		const { client, db } = createTestDatabase();
		const admin = insertUser(client, "root_admin", "admin");
		const ada = insertUser(client, "ada");
		const sectionsFor = async (userId: number) => {
			const { html } = await renderPage(page, { db, session: await signIn(db, userId) }, path, { username: "ada" });
			return settingsSections.filter((section) => html.includes(`href="${settingsHref("ada", section)}"`));
		};

		expect({ owner: await sectionsFor(ada.id), admin: await sectionsFor(admin.id) }).toEqual({
			owner: ["profile", "location", "notifications", "security", "data"],
			admin: ["profile", "notifications", "security"],
		});
	});

	it("are closed to a User who is not an Admin, for the settings of another", async () => {
		const { client, db } = createTestDatabase();
		const ada = insertUser(client, "ada");
		insertUser(client, "bob");

		const { response } = await renderPage(SettingsPage, { db, session: await signIn(db, ada.id) }, "/bob/settings", { username: "bob" });

		expect(response.status).toBe(403);
	});

	it("forbid the data of a User to an Admin", async () => {
		const { client, db } = createTestDatabase();
		const admin = insertUser(client, "root_admin", "admin");
		const ada = insertUser(client, "ada");

		const { response, html } = await renderPage(DataSettingsPage, { db, session: await signIn(db, admin.id) }, "/ada/settings/data", { username: "ada" });

		expect(response.status).toBe(403);
		expect(html).not.toContain(ada.email);
	});

	it("label every field, whether its label is text or markup", async () => {
		const { client, db } = createTestDatabase();
		const ada = insertUser(client, "ada");
		const session = await signIn(db, ada.id);
		const failedDeletion = { name: "deleteAccount", failure: { code: "BAD_REQUEST", message: "Invalid", fields: { confirmation: ["Type your username exactly as shown."] }, input: [] } };

		const profile = (await renderPage(ProfileSettingsPage, { db, session }, "/ada/settings/profile", { username: "ada" })).html;
		const data = (await renderPage(DataSettingsPage, { db, session, actionOutcome: failedDeletion }, "/ada/settings/data", { username: "ada" })).html;

		expect(profile).toMatch(/for="fullname">\s*Full name\s*</);
		expect(profile).toMatch(/for="username">\s*Username\s*</);
		expect(data).toMatch(/for="confirmation">\s*Type <strong>ada<\/strong> to confirm/);
	});

	it("send a Username in the wrong letter case to the same section", async () => {
		const { client, db } = createTestDatabase();
		const ada = insertUser(client, "ada");

		const { response } = await renderPage(LocationSettingsPage, { db, session: await signIn(db, ada.id) }, "/Ada/settings/location", { username: "Ada" });

		expect(response.status).toBe(301);
		expect(response.headers.get("Location")).toBe("/ada/settings/location");
	});
});
