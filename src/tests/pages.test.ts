import { describe, expect, it } from "vitest";
import { createSession } from "@src/auth/session";
import * as s from "@src/db/schema";
import AdminPage from "@src/pages/admin/index.astro";
import AdminCitiesPage from "@src/pages/admin/cities/index.astro";
import AdminCitySearchPage from "@src/pages/admin/cities/searches/[id].astro";
import AdminRestaurantsPage from "@src/pages/admin/restaurants/index.astro";
import AdminUsersPage from "@src/pages/admin/users/index.astro";
import AdminUserPage from "@src/pages/admin/users/[username].astro";
import SessionPage from "@src/pages/[username]/settings/sessions/[sessionId].astro";
import SettingsPage from "@src/pages/[username]/settings/index.astro";
import LocationSettingsPage from "@src/pages/[username]/settings/location.astro";
import RestaurantPage from "@src/pages/restaurants/[id].astro";
import * as ExportEndpoint from "@src/pages/api/users/[username]/export";
import { renderPage, requestEndpoint } from "@src/tests/container";
import { createTestDatabase, insertRestaurant, insertUser, signIn } from "@src/tests/database";

describe("pages", () => {
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
