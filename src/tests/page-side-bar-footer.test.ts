import { experimental_AstroContainer as AstroContainer } from "astro/container";
import { describe, expect, it } from "vitest";
import SideBarFooter from "@src/components/SideBarFooter.astro";
import SettingsPage from "@src/pages/[username]/settings.astro";
import NotFoundPage from "@src/pages/404.astro";
import { createSession, getSession } from "@src/auth/session";
import { createDrizzleDatabase, migrateDrizzleDatabase } from "@src/db";
import { users, type User } from "@src/db/schema";

describe("SideBarFooter", () => {
	it("encodes usernames before using them in path links", async () => {
		const user: User = {
			id: 1,
			fullname: "First User",
			username: "First#1",
			email: "first@example.com",
			emailVerified: false,
			profilePictureId: null,
			role: "user",
			bio: null,
			pronoun: null,
			latitude: null,
			longitude: null,
			updatedAt: new Date(),
			createdAt: new Date(),
		};
		const container = await AstroContainer.create();
		const response = await container.renderToResponse(SideBarFooter, {
			props: { user },
		});
		const html = await response.text();

		expect(html).toContain('href="/First%231/settings"');
	});

	it("posts the sign-out form to the absolute logout route", async () => {
		const user: User = {
			id: 1,
			fullname: "First User",
			username: "first_1",
			email: "first@example.com",
			emailVerified: false,
			profilePictureId: null,
			role: "user",
			bio: null,
			pronoun: null,
			latitude: null,
			longitude: null,
			updatedAt: new Date(),
			createdAt: new Date(),
		};
		const container = await AstroContainer.create();
		const response = await container.renderToResponse(SideBarFooter, {
			props: { user },
		});
		const html = await response.text();

		expect(html).toContain('action="/api/logout"');
	});

	it("shows not found instead of failing on a percent sign in the username", async () => {
		const db = createDrizzleDatabase("file:settings-percent?mode=memory");
		migrateDrizzleDatabase(db);
		const user = db
			.insert(users)
			.values({
				fullname: "First User",
				username: "first_1",
				email: "first@example.com",
			})
			.returning()
			.get();
		const session = await createSession(user.id, db);
		const sessionWithUser = await getSession(session.id, db);
		const container = await AstroContainer.create();
		container.insertPageRoute("/404", NotFoundPage);
		const response = await container.renderToResponse(SettingsPage, {
			locals: { db, session: sessionWithUser },
			params: { username: "100%" },
		});

		expect(response.status).toBe(404);
	});
});
