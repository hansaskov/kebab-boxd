import { experimental_AstroContainer as AstroContainer } from "astro/container";
import { describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import ProfilePage from "@src/pages/[username]/profile.astro";
import NotFoundPage from "@src/pages/404.astro";
import type { SessionWithUser } from "@src/auth/session";
import type { Database } from "@src/db";
import * as s from "@src/db/schema";
import { server } from "@src/actions/index";
import { actionContext, form, withActionResult } from "@src/tests/actions";
import { createTestDatabase, insertRestaurant, insertReview, insertUser, signIn } from "@src/tests/database";

async function renderProfile(db: Database, viewer: SessionWithUser, username: string, search = "", locals: App.Locals = { db, session: viewer }) {
	const container = await AstroContainer.create();
	container.insertPageRoute("/404", NotFoundPage);
	const response = await container.renderToResponse(ProfilePage, {
		locals,
		params: { username },
		request: new Request(`http://localhost/${username}/profile${search}`),
	});
	return { response, html: await response.text() };
}

function buttons(html: string) {
	return [...html.matchAll(/<(?:a|button) class="btn btn-(?:primary|secondary) btn-md[^"]*"[^>]*>([^<]+)</g)].map((match) =>
		match[1]!.trim(),
	);
}

describe("ProfilePage", () => {
	it("shows the public reviews, followers and lists of the user", async () => {
		const { client, db } = createTestDatabase("profile-page-content");
		const ada = insertUser(client, "ada");
		const bob = insertUser(client, "bob");
		const grill = insertRestaurant(client, "Bosporus Grill", { status: "approved" });
		const pending = insertRestaurant(client, "Mangal Express");
		insertReview(client, bob.id, grill.id, 9);
		insertReview(client, bob.id, pending.id, 4);
		client.insert(s.favorites).values({ userId: bob.id, restaurantId: grill.id }).run();
		client.insert(s.followers).values({ followerId: ada.id, followingId: bob.id }).run();

		const { response, html } = await renderProfile(db, await signIn(db, ada.id), "bob");

		expect(response.status).toBe(200);
		expect(html).toContain("Bosporus Grill");
		expect(html).toContain('aria-label="4.5 out of 5 stars"');
		expect(html).not.toContain("Mangal Express");
		expect(html).toMatch(/>1<\/span> follower\b/);
		expect(html).toMatch(/Favorites\s*<span[^>]*>1<\/span>/);
		expect(buttons(html)).toEqual(["Unfollow"]);
	});

	it("offers to edit your own profile and to follow someone else", async () => {
		const { client, db } = createTestDatabase("profile-page-actions");
		const ada = insertUser(client, "ada");
		insertUser(client, "bob");
		const session = await signIn(db, ada.id);

		expect(buttons((await renderProfile(db, session, "ada")).html)).toEqual(["Edit profile"]);
		expect(buttons((await renderProfile(db, session, "bob")).html)).toEqual(["Follow"]);
	});

	it("tells users that a banned account is suspended without showing its data, and shows admins everything", async () => {
		const { client, db } = createTestDatabase("profile-page-banned");
		const admin = insertUser(client, "root_admin", "admin");
		const ada = insertUser(client, "ada");
		const bob = insertUser(client, "bob");
		client.update(s.users).set({ bio: "Secret sauce" }).where(eq(s.users.id, bob.id)).run();
		const grill = insertRestaurant(client, "Bosporus Grill", { status: "approved" });
		insertReview(client, bob.id, grill.id, 9);
		await db.mutations.users.ban(bob.id, admin.id);

		const asUser = await renderProfile(db, await signIn(db, ada.id), "bob");
		const asAdmin = await renderProfile(db, await signIn(db, admin.id), "bob");

		expect(asUser.response.status).toBe(200);
		expect(asUser.html).toContain("This account has been suspended.");
		for (const data of [bob.fullname, "Secret sauce", "Bosporus Grill"]) {
			expect(asUser.html).not.toContain(data);
		}
		expect(buttons(asUser.html)).toEqual([]);
		expect(asAdmin.response.status).toBe(200);
		expect(asAdmin.html).toContain("Secret sauce");
		expect(asAdmin.html).toContain("Banned");
		expect(buttons(asAdmin.html)).toEqual(["Edit profile"]);
	});

	it("lets a follower unfollow a suspended account", async () => {
		const { client, db } = createTestDatabase("profile-page-banned-unfollow");
		const admin = insertUser(client, "root_admin", "admin");
		const ada = insertUser(client, "ada");
		const bob = insertUser(client, "bob");
		const cleo = insertUser(client, "cleo");
		const adaSession = await signIn(db, ada.id);
		await db.mutations.follows.follow(ada.id, bob.id);
		await db.mutations.users.ban(bob.id, admin.id);

		const asFollower = await renderProfile(db, adaSession, "bob");
		const asOther = await renderProfile(db, await signIn(db, cleo.id), "bob");

		expect(asFollower.html).toContain("This account has been suspended.");
		expect(asFollower.html).not.toContain(bob.fullname);
		expect(buttons(asFollower.html)).toEqual(["Unfollow"]);
		expect(buttons(asOther.html)).toEqual([]);

		const unfollowed = await server.profile.unfollow.call(actionContext(db, adaSession), form({ username: "bob" }));

		expect(unfollowed.error).toBeUndefined();
		expect(buttons((await renderProfile(db, adaSession, "bob")).html)).toEqual([]);
	});

	it("sends a username in other letter case to the profile address", async () => {
		const { client, db } = createTestDatabase("profile-page-case");
		const ada = insertUser(client, "ada");

		const { response } = await renderProfile(db, await signIn(db, ada.id), "Ada", "?tab=favorites");

		expect(response.status).toBe(301);
		expect(response.headers.get("Location")).toBe("/ada/profile?tab=favorites");
	});

	it("shows why a follow of a suspended account failed", async () => {
		const { client, db } = createTestDatabase("profile-page-follow-failed");
		const admin = insertUser(client, "root_admin", "admin");
		const ada = insertUser(client, "ada");
		const bob = insertUser(client, "bob");
		const session = await signIn(db, ada.id);
		await db.mutations.users.ban(bob.id, admin.id);

		const followed = await server.profile.follow.call(actionContext(db, session), form({ username: "bob" }));
		const locals = withActionResult({ db, session }, "profile.follow", followed);
		const { html } = await renderProfile(db, session, "bob", "", locals);

		expect(followed.error?.code).toBe("FORBIDDEN");
		expect(html).toContain("This account has been suspended.");
		expect(html).toContain("Follow failed");
		expect(html).toContain("You cannot follow this user.");
	});
});
