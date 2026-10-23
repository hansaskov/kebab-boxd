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
import { createTestDatabase, insertUser, signIn } from "@src/tests/database";

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

function nextHref(html: string) {
	return html.match(/rel="next" href="([^"]*)"/)?.[1]?.replaceAll("&amp;", "&");
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

	it("searches and filters the users, and keeps both when paging", async () => {
		const { client, db } = createTestDatabase("admin-users-search");
		const admin = insertUser(client, "ada", "admin");
		const kebabs = Array.from({ length: 11 }, (_, i) => insertUser(client, `kebab_${i}`));
		insertUser(client, "kebab_free");
		insertUser(client, "falafel");
		for (const kebab of kebabs) {
			await db.mutations.users.ban(kebab.id, admin.id);
		}
		const session = await signIn(db, admin.id);

		const first = await render(AdminUsersPage, db, session, "/admin/users?q=kebab&filter=banned&rows=10");

		expect(listedUsernames(first.html)).toEqual(kebabs.toReversed().slice(0, 10).map((user) => user.username));
		expect(first.html).toContain("11 users");
		expect(nextHref(first.html)).toBe(`/admin/users?q=kebab&filter=banned&rows=10&after=${kebabs[1]!.id}`);

		const second = await render(AdminUsersPage, db, session, nextHref(first.html)!);

		expect(listedUsernames(second.html)).toEqual(["kebab_0"]);
		expect(nextHref(second.html)).toBeUndefined();
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
