import { experimental_AstroContainer as AstroContainer } from "astro/container";
import { describe, expect, it } from "vitest";
import SideBarFooter from "@src/components/SideBarFooter.astro";
import SettingsPage from "@src/pages/[username]/settings.astro";
import { createSession } from "@src/auth/session";
import { createDrizzleDatabase, migrateDrizzleDatabase } from "@src/db";
import { users, type User } from "@src/db/schema";

describe("SideBarFooter", () => {
	it("encodes usernames before using them in path links", async () => {
		const user: User = {
			id: 1,
			fullname: "First User",
			username: "First#1",
			email: "first@example.com",
			googleId: "google-1",
			profilePictureId: null,
			isAdmin: false,
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

		expect(html).toContain('href="/First%231/settings#account"');
	});

	it("loads settings for an encoded username containing a hash", async () => {
		const db = createDrizzleDatabase("file:settings-hash?mode=memory");
		migrateDrizzleDatabase(db);
		const user = db
			.insert(users)
			.values({
				fullname: "First User",
				username: "First#1",
				email: "first@example.com",
				googleId: "google-1",
			})
			.returning()
			.get();
		const session = await createSession(user.id, db);
		const container = await AstroContainer.create();
		const response = await container.renderToResponse(SettingsPage, {
			locals: { db, session: { ...session, user } },
			params: { username: "First%231" },
		});

		expect(response.status).toBe(200);
	});
});
