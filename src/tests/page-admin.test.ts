import { experimental_AstroContainer as AstroContainer } from "astro/container";
import { describe, expect, it } from "vitest";
import type { AstroComponentFactory } from "astro/runtime/server/index.js";
import AdminPage from "@src/pages/admin/index.astro";
import AdminUsersPage from "@src/pages/admin/users/index.astro";
import AdminUserPage from "@src/pages/admin/users/[username].astro";
import ForbiddenPage from "@src/pages/403.astro";
import NotFoundPage from "@src/pages/404.astro";
import { createSession, getSession } from "@src/auth/session";
import type { Database } from "@src/db";
import { banAs, createTestDatabase, insertUser } from "@src/tests/database";

async function render(
	page: AstroComponentFactory,
	db: Database,
	viewerSessionId: string,
	path: string,
	params: Record<string, string> = {},
) {
	const container = await AstroContainer.create();
	container.insertPageRoute("/403", ForbiddenPage);
	container.insertPageRoute("/404", NotFoundPage);
	const response = await container.renderToResponse(page, {
		locals: { db, session: await getSession(viewerSessionId, db) },
		params,
		request: new Request(`http://localhost${path}`),
	});
	return { response, html: await response.text() };
}

function listedUsernames(html: string) {
	return [...html.matchAll(/href="\/admin\/users\/([a-z0-9_]+)"/g)].map((match) => match[1]);
}

function linkHref(html: string, rel: "prev" | "next") {
	return html.match(new RegExp(`rel="${rel}" href="([^"]*)"`))?.[1]?.replaceAll("&amp;", "&");
}

describe("admin console access", () => {
	it.each([
		["/admin", AdminPage, {}],
		["/admin/users", AdminUsersPage, {}],
		["/admin/users/ada", AdminUserPage, { username: "ada" }],
		["/admin/users/nobody", AdminUserPage, { username: "nobody" }],
	] as const)("does not let a user who is not an admin open %s", async (path, page, params) => {
		const { client, db } = createTestDatabase(`admin-forbidden-${path.replaceAll("/", "-")}`);
		const ada = insertUser(client, "ada");
		const adaSession = await createSession(ada.id, db);

		const { response, html } = await render(page, db, adaSession.id, path, params);

		expect(response.status).toBe(403);
		expect(html).not.toContain("Admin console</h1>");
	});

	it("sends a visitor who is not signed in to the login page", async () => {
		const { db } = createTestDatabase("admin-signed-out");
		const container = await AstroContainer.create();

		const response = await container.renderToResponse(AdminUsersPage, { locals: { db, session: null } });

		expect(response.status).toBe(302);
		expect(response.headers.get("Location")).toBe("/login");
	});
});

describe("AdminPage", () => {
	it("shows how many users, admins and banned users there are", async () => {
		const { client, db } = createTestDatabase("admin-overview");
		const admin = insertUser(client, "ada", "admin");
		const bob = insertUser(client, "bob");
		insertUser(client, "cyd");
		await banAs(db, admin.id, bob.id);
		const adminSession = await createSession(admin.id, db);

		const { response, html } = await render(AdminPage, db, adminSession.id, "/admin");

		expect(response.status).toBe(200);
		expect(html).toMatch(/Users<\/span>\s*<span[^>]*>3<\/span>/);
		expect(html).toMatch(/Admins<\/span>\s*<span[^>]*>1<\/span>/);
		expect(html).toMatch(/Banned<\/span>\s*<span[^>]*>1<\/span>/);
		expect(html).toContain('href="/admin/users?filter=banned"');
	});
});

describe("AdminUsersPage", () => {
	it("lists users a page at a time and links to the next page", async () => {
		const { client, db } = createTestDatabase("admin-users-pages");
		const admin = insertUser(client, "admin_user", "admin");
		for (let i = 0; i < 11; i++) {
			insertUser(client, `user_${i}`);
		}
		const adminSession = await createSession(admin.id, db);

		const first = await render(AdminUsersPage, db, adminSession.id, "/admin/users?rows=10");

		expect(listedUsernames(first.html)).toHaveLength(10);
		expect(listedUsernames(first.html)[0]).toBe("user_10");
		expect(first.html).toContain("12 users");
		expect(linkHref(first.html, "prev")).toBeUndefined();
		expect(linkHref(first.html, "next")).toBe("/admin/users?rows=10&after=3");

		const second = await render(AdminUsersPage, db, adminSession.id, "/admin/users?rows=10&after=3");

		expect(listedUsernames(second.html)).toEqual(["user_0", "admin_user"]);
		expect(second.html).toContain("12 users");
		expect(linkHref(second.html, "prev")).toBe("/admin/users?rows=10&before=2");
		expect(linkHref(second.html, "next")).toBeUndefined();

		const back = await render(AdminUsersPage, db, adminSession.id, "/admin/users?rows=10&before=2");

		expect(listedUsernames(back.html)).toEqual(listedUsernames(first.html));
	});

	it("links back from a page past the end", async () => {
		const { client, db } = createTestDatabase("admin-users-past-end");
		const admin = insertUser(client, "ada", "admin");
		insertUser(client, "bob");
		const adminSession = await createSession(admin.id, db);

		const { html } = await render(AdminUsersPage, db, adminSession.id, "/admin/users?after=1");

		expect(html).toContain("There are no users on this page.");
		expect(linkHref(html, "prev")).toBe("/admin/users?before=1");
	});

	it("searches and filters, and keeps both when paging", async () => {
		const { client, db } = createTestDatabase("admin-users-search");
		const admin = insertUser(client, "ada", "admin");
		const kebabs = Array.from({ length: 11 }, (_, i) => insertUser(client, `kebab_${i}`));
		insertUser(client, "falafel");
		for (const kebab of kebabs) {
			await banAs(db, admin.id, kebab.id);
		}
		const adminSession = await createSession(admin.id, db);

		const { html } = await render(AdminUsersPage, db, adminSession.id, "/admin/users?q=kebab&filter=banned&rows=10");

		expect(listedUsernames(html)).toHaveLength(10);
		expect(listedUsernames(html).every((username) => username?.startsWith("kebab_"))).toBe(true);
		expect(html).toContain('value="kebab"');
		expect(html).toContain('<input type="hidden" name="filter" value="banned">');
		expect(html).toContain('<input type="hidden" name="rows" value="10">');
		expect(linkHref(html, "next")).toBe("/admin/users?q=kebab&filter=banned&rows=10&after=3");

		const second = await render(AdminUsersPage, db, adminSession.id, linkHref(html, "next")!);

		expect(listedUsernames(second.html)).toEqual(["kebab_0"]);
		expect(second.html).toContain('<input type="hidden" name="filter" value="banned">');
		expect(second.html).toContain('<input type="hidden" name="rows" value="10">');
		expect(second.html).not.toContain('name="after"');
	});

	it("says when no user matches the search", async () => {
		const { client, db } = createTestDatabase("admin-users-no-match");
		const admin = insertUser(client, "ada", "admin");
		const adminSession = await createSession(admin.id, db);

		const { html } = await render(AdminUsersPage, db, adminSession.id, "/admin/users?q=shawarma");

		expect(html).toContain("No users match “shawarma”.");
		expect(html).not.toContain('name="rows"');
		expect(listedUsernames(html)).toEqual([]);
	});

	it("marks only the Users link in the menu as the current page", async () => {
		const { client, db } = createTestDatabase("admin-users-menu");
		const admin = insertUser(client, "ada", "admin");
		const adminSession = await createSession(admin.id, db);

		const { html } = await render(AdminUsersPage, db, adminSession.id, "/admin/users");

		expect(html).toMatch(/href="\/admin\/users" class="nav-link" aria-current="page"/);
		expect(html).toMatch(/href="\/admin" class="nav-link">/);
	});
});

describe("AdminUserPage", () => {
	it("lets an admin ban a user and change their role", async () => {
		const { client, db } = createTestDatabase("admin-user-actions");
		const admin = insertUser(client, "ada", "admin");
		insertUser(client, "bob");
		const adminSession = await createSession(admin.id, db);

		const { response, html } = await render(AdminUserPage, db, adminSession.id, "/admin/users/bob", { username: "bob" });

		expect(response.status).toBe(200);
		expect(html).toContain("<h1>bob user</h1>");
		expect(html).toContain("Ban user</button>");
		expect(html).toContain("Save role</button>");
		expect(html).toContain('href="/bob/settings#account"');
	});

	it("offers to lift the ban of a banned user", async () => {
		const { client, db } = createTestDatabase("admin-user-banned");
		const admin = insertUser(client, "ada", "admin");
		const bob = insertUser(client, "bob");
		await banAs(db, admin.id, bob.id);
		const adminSession = await createSession(admin.id, db);

		const { html } = await render(AdminUserPage, db, adminSession.id, "/admin/users/bob", { username: "bob" });

		expect(html).toContain("Lift ban</button>");
		expect(html).not.toContain("Ban user</button>");
	});

	it("does not offer an admin to ban themselves or change their own role", async () => {
		const { client, db } = createTestDatabase("admin-user-self");
		const admin = insertUser(client, "ada", "admin");
		const adminSession = await createSession(admin.id, db);

		const { html } = await render(AdminUserPage, db, adminSession.id, "/admin/users/ada", { username: "ada" });

		expect(html).toContain("You cannot ban yourself.");
		expect(html).toContain("You cannot change your own role.");
		expect(html).not.toContain("Ban user</button>");
		expect(html).not.toContain("Save role</button>");
	});

	it("asks for the Admin role to be removed before another admin can be banned", async () => {
		const { client, db } = createTestDatabase("admin-user-other-admin");
		const admin = insertUser(client, "ada", "admin");
		insertUser(client, "bob", "admin");
		const adminSession = await createSession(admin.id, db);

		const { html } = await render(AdminUserPage, db, adminSession.id, "/admin/users/bob", { username: "bob" });

		expect(html).toContain("Remove the Admin role before you ban this user.");
		expect(html).toContain("Save role</button>");
	});

	it("shows 404 for a user that does not exist", async () => {
		const { client, db } = createTestDatabase("admin-user-missing");
		const admin = insertUser(client, "ada", "admin");
		const adminSession = await createSession(admin.id, db);

		const { response } = await render(AdminUserPage, db, adminSession.id, "/admin/users/nobody", { username: "nobody" });

		expect(response.status).toBe(404);
	});
});
