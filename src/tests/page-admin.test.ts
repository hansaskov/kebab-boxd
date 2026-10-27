import { experimental_AstroContainer as AstroContainer } from "astro/container";
import { describe, expect, it } from "vitest";
import type { AstroComponentFactory } from "astro/runtime/server/index.js";
import AdminPage from "@src/pages/admin/index.astro";
import AdminUsersPage from "@src/pages/admin/users/index.astro";
import AdminUserPage from "@src/pages/admin/users/[username].astro";
import ForbiddenPage from "@src/pages/403.astro";
import NotFoundPage from "@src/pages/404.astro";
import type { SessionWithUser } from "@src/auth/session";
import type { Database } from "@src/db";
import { createTestDatabase, insertRestaurant, insertUser, signIn } from "@src/tests/database";

async function render(
	page: AstroComponentFactory,
	db: Database,
	session: SessionWithUser,
	path: string,
	params: Record<string, string> = {},
) {
	const container = await AstroContainer.create();
	container.insertPageRoute("/403", ForbiddenPage);
	container.insertPageRoute("/404", NotFoundPage);
	const response = await container.renderToResponse(page, {
		locals: { db, session },
		params,
		request: new Request(`http://localhost${path}`),
	});
	return { response, html: await response.text() };
}

function listedUsernames(html: string) {
	return [...html.matchAll(/href="\/admin\/users\/([a-z0-9_]+)"/g)].map((match) => match[1]);
}

describe("admin console", () => {
	it.each([
		["/admin", AdminPage, {}],
		["/admin/users", AdminUsersPage, {}],
		["/admin/users/nobody", AdminUserPage, { username: "nobody" }],
	] as const)("does not let a user who is not an admin open %s", async (path, page, params) => {
		const { client, db } = createTestDatabase(`admin-forbidden-${path.replaceAll("/", "-")}`);
		const ada = insertUser(client, "ada");

		const { response } = await render(page, db, await signIn(db, ada.id), path, params);

		expect(response.status).toBe(403);
	});

	it("matches percent signs and underscores in the search literally", async () => {
		const { client, db } = createTestDatabase("admin-users-search-wildcards");
		const admin = insertUser(client, "root_admin", "admin");
		insertUser(client, "kebab_king");
		insertUser(client, "kebabxking");
		const session = await signIn(db, admin.id);

		const underscore = await render(AdminUsersPage, db, session, "/admin/users?q=b_k");
		const percent = await render(AdminUsersPage, db, session, "/admin/users?q=%25");

		expect(listedUsernames(underscore.html)).toEqual(["kebab_king"]);
		expect(underscore.html).toContain("1 user<");
		expect(listedUsernames(percent.html)).toEqual([]);
		expect(percent.html).toContain("No users match “%”.");
	});

	it("counts all users, admins and banned users, and the restaurants by status", async () => {
		const { client, db } = createTestDatabase("admin-console-counts");
		const admin = insertUser(client, "root_admin", "admin");
		const ada = insertUser(client, "ada");
		insertUser(client, "bob");
		await db.mutations.users.ban(ada.id, admin.id);
		insertRestaurant(client, "Bosporus Grill", { status: "approved" });
		insertRestaurant(client, "Mangal Express");
		insertRestaurant(client, "Hasir Kebab");

		const { html } = await render(AdminPage, db, await signIn(db, admin.id), "/admin");
		const counts = [...html.matchAll(/text-fg-muted">(\w+)<\/span>\s*<span class="t-body block font-medium">(\d+)</g)];

		expect(Object.fromEntries(counts.map((match) => [match[1], Number(match[2])]))).toEqual({
			Users: 3,
			Admins: 1,
			Banned: 1,
			Waiting: 2,
			Approved: 1,
			Rejected: 0,
		});
	});

	it("sends a username in other letter case to the address of the user", async () => {
		const { client, db } = createTestDatabase("admin-user-page-case");
		const admin = insertUser(client, "root_admin", "admin");
		insertUser(client, "ada");

		const { response } = await render(AdminUserPage, db, await signIn(db, admin.id), "/admin/users/Ada?x=1", { username: "Ada" });

		expect(response.status).toBe(301);
		expect(response.headers.get("Location")).toBe("/admin/users/ada?x=1");
	});
});
