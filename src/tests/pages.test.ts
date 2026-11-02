import { describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { createSession } from "@src/auth/session";
import * as s from "@src/db/schema";
import AdminPage from "@src/pages/admin/index.astro";
import AdminRestaurantsPage from "@src/pages/admin/restaurants/index.astro";
import AdminUsersPage from "@src/pages/admin/users/index.astro";
import AdminUserPage from "@src/pages/admin/users/[username].astro";
import ProfilePage from "@src/pages/[username]/profile.astro";
import SessionPage from "@src/pages/[username]/settings/sessions/[sessionId].astro";
import RestaurantPage from "@src/pages/restaurants/[id].astro";
import * as ExportEndpoint from "@src/pages/api/users/[username]/export";
import { renderPage, requestEndpoint } from "@src/tests/container";
import { createTestDatabase, insertRestaurant, insertReview, insertUser, signIn } from "@src/tests/database";

describe("pages", () => {
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
		const bobSession = await createSession(bob.id, db);
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
