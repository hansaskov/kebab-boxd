import { experimental_AstroContainer as AstroContainer } from "astro/container";
import { describe, expect, it } from "vitest";
import SettingsPage from "@src/pages/[username]/settings.astro";
import { createSession, getSession } from "@src/auth/session";
import { createDrizzleDatabase, migrateDrizzleDatabase } from "@src/db";
import { users } from "@src/db/schema";

describe("SettingsPage", () => {
	it("renders a form connected to the settings action", async () => {
		const db = createDrizzleDatabase("file:settings-form?mode=memory");
		migrateDrizzleDatabase(db);
		const user = db
			.insert(users)
			.values({
				fullname: "First User",
				username: "firstuser",
				email: "first@example.com",
				googleId: "google-1",
			})
			.returning()
			.get();
		const session = await createSession(user.id, db);
		const sessionWithUser = await getSession(session.id, db);
		const container = await AstroContainer.create();

		const response = await container.renderToResponse(SettingsPage, {
			locals: { db, session: sessionWithUser },
			params: { username: user.username },
			request: new Request(`http://localhost/${user.username}/settings`, {
				headers: { cookie: `session=${session.token}` },
			}),
		});
		const html = await response.text();

		expect(html).toContain('action="?_action=updateSettings"');
		expect(html).toContain('name="fullname"');
		expect(html).toContain('name="username"');
		expect(html).toContain('name="pronoun"');
		expect(html).toContain('name="bio"');
		expect(html).toContain('<fieldset class="space-y-6">');
		expect(html).not.toContain("fieldset-label");
		expect(html).not.toContain("fieldset-legend");
	});
});
