import { describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import * as s from "@src/db/schema";
import PeoplePage from "@src/pages/people.astro";
import ProfilePage from "@src/pages/[username]/profile.astro";
import { linkHref, renderPage } from "@src/tests/container";
import { createTestDatabase, insertUser, signIn } from "@src/tests/database";

function people(html: string) {
	return [...html.matchAll(/<span class="t-body-sm block truncate text-fg-muted">@([a-z0-9_]+)<\/span>/g)].map((match) => match[1]);
}

function followButtons(html: string) {
	return [...html.matchAll(/<input type="hidden" name="username" value="([a-z0-9_]+)"[^>]*>\s*<button[^>]*>\s*(Follow|Unfollow)/g)].map(
		(match) => `${match[2]} ${match[1]}`,
	);
}

describe("PeoplePage", () => {
	it("finds people by name or username, but not by email address and not when they are banned", async () => {
		const { client, db } = createTestDatabase("people-search");
		const admin = insertUser(client, "root_admin", "admin");
		const ada = insertUser(client, "ada");
		insertUser(client, "kebab_king");
		const dan = insertUser(client, "dan");
		client.update(s.users).set({ fullname: "Kebab Queen" }).where(eq(s.users.id, dan.id)).run();
		const eve = insertUser(client, "eve");
		client.update(s.users).set({ email: "kebab@example.com" }).where(eq(s.users.id, eve.id)).run();
		const banned = insertUser(client, "kebab_spam");
		await db.mutations.users.ban(banned.id, admin.id);

		const { html } = await renderPage(PeoplePage, { db, session: await signIn(db, ada.id) }, "/people?q=kebab");

		expect(people(html)).toEqual(["dan", "kebab_king"]);
	});

	it("offers to follow the people found, and to unfollow the ones the user follows", async () => {
		const { client, db } = createTestDatabase("people-follow");
		const ada = insertUser(client, "ada");
		const bob = insertUser(client, "bob_kebab");
		insertUser(client, "cy_kebab");
		await db.mutations.follows.follow(ada.id, bob.id);

		const { html } = await renderPage(PeoplePage, { db, session: await signIn(db, ada.id) }, "/people?q=kebab");

		expect(followButtons(html)).toEqual(["Unfollow bob_kebab", "Follow cy_kebab"]);
	});

	it("shows nothing before the user searches", async () => {
		const { client, db } = createTestDatabase("people-empty");
		const ada = insertUser(client, "ada");
		insertUser(client, "bob");

		expect(people((await renderPage(PeoplePage, { db, session: await signIn(db, ada.id) }, "/people")).html)).toEqual([]);
	});
});

describe("ProfilePage follower lists", () => {
	it("list the followers and the people followed, except banned users, with paging", async () => {
		const { client, db } = createTestDatabase("profile-followers");
		const admin = insertUser(client, "root_admin", "admin");
		const ada = insertUser(client, "ada");
		const bob = insertUser(client, "bob");
		const fans = Array.from({ length: 11 }, (_, i) => insertUser(client, `fan_${String(i).padStart(2, "0")}`));
		for (const fan of fans) await db.mutations.follows.follow(fan.id, bob.id);
		await db.mutations.follows.follow(bob.id, ada.id);
		await db.mutations.users.ban(fans[0]!.id, admin.id);
		const session = await signIn(db, ada.id);
		const render = (search: string) => renderPage(ProfilePage, { db, session }, `/bob/profile${search}`, { username: "bob" });

		const first = await render("?tab=followers&rows=10");
		const second = await render(new URL(linkHref(first.html, "next")!, "http://localhost").search);
		const following = await render("?tab=following");

		expect([...people(first.html), ...people(second.html)].toSorted()).toEqual(fans.slice(1).map((fan) => fan.username));
		expect(people(first.html)).toHaveLength(10);
		expect(people(following.html)).toEqual(["ada"]);
	});
});
