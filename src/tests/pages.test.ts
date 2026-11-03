import { describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { createSession } from "@src/auth/session";
import * as s from "@src/db/schema";
import AdminPage from "@src/pages/admin/index.astro";
import AdminRestaurantsPage from "@src/pages/admin/restaurants/index.astro";
import AdminUsersPage from "@src/pages/admin/users/index.astro";
import AdminUserPage from "@src/pages/admin/users/[username].astro";
import LoginPage from "@src/pages/login.astro";
import ProfilePage from "@src/pages/[username]/profile.astro";
import SessionPage from "@src/pages/[username]/settings/sessions/[sessionId].astro";
import RestaurantPage from "@src/pages/restaurants/[id].astro";
import SearchPage from "@src/pages/search.astro";
import * as ExportEndpoint from "@src/pages/api/users/[username]/export";
import { renderPage, requestEndpoint } from "@src/tests/container";
import { createTestDatabase, insertRestaurant, insertReview, insertUser, signIn } from "@src/tests/database";

describe("pages", () => {
	it("invite a visitor who is not signed in to sign in with Google", async () => {
		const { db } = createTestDatabase();

		const { response, html } = await renderPage(LoginPage, { db, session: null }, "/login?error=banned");

		expect(response.status).toBe(200);
		expect(html).toContain('href="/api/google"');
		expect(html).toContain("Account banned");
	});

	it("send a signed-in User from the sign-in page to their Feed", async () => {
		const { client, db } = createTestDatabase();
		const ada = insertUser(client, "ada");

		const { response } = await renderPage(LoginPage, { db, session: await signIn(db, ada.id) }, "/login");

		expect(response.status).toBe(302);
		expect(response.headers.get("Location")).toBe("/");
	});

	it.each([
		["/admin", AdminPage, {}],
		["/admin/restaurants", AdminRestaurantsPage, {}],
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
});
