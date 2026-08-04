import { experimental_AstroContainer as AstroContainer } from 'astro/container';
import { describe, it, expect  } from "vitest";
import Explore from "@src/pages/explore.astro"
import { createDrizzleDatabase, migrateDrizzleDatabase } from '@src/db/index';
import { seedDatabase } from '@src/db/seed';
import { createSession, getSession } from '@src/auth/session';

describe("GET /explore (unauthenticated)", () => {

	it("redirects to /login when no session cookie is present", async () => {
		const db = createDrizzleDatabase("file:test?mode=memory");
		migrateDrizzleDatabase(db)

		const container = await AstroContainer.create();
		const response = await container.renderToResponse(Explore, {locals: { db, session: null }})

		expect(response.status).toBe(302);
		expect(response.headers.get("Location")).toBe("/login");
	});

	it("Login to the main page as an authenticated user", async () => {
		const db = createDrizzleDatabase("file:test?mode=memory");
		migrateDrizzleDatabase(db)
		await seedDatabase(db)

		const user = await db.query.users.findFirst();
		const session = await createSession(user!.id, db);
		const sessionWithUser = await getSession(session.id, db)
		const container = await AstroContainer.create();

		const response = await container.renderToResponse(Explore, {
			locals: { db, session: sessionWithUser },
		});

		expect(response.status).toBe(200);
	});

});
