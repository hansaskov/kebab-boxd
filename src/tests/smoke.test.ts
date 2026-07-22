import { experimental_AstroContainer as AstroContainer } from 'astro/container';
import { describe, it, expect  } from "vitest";
import Explore from "../pages/explore.astro"
import { createDatabase, migrateDatabase } from '@db/index';
import { seedDatabase } from '@db/seed';
import { createSession } from '@auth/session';

describe("GET /explore (unauthenticated)", () => {

	it("redirects to /login when no session cookie is present", async () => {
		const db = createDatabase("file:test?mode=memory");
		migrateDatabase(db)

		const container = await AstroContainer.create();
		const response = await container.renderToResponse(Explore, {locals: { db }})

		expect(response.status).toBe(302);
		expect(response.headers.get("Location")).toBe("/login");
	});

	it("Login to the main page as an authenticated user", async () => {
		const db = createDatabase("file:test?mode=memory");
		migrateDatabase(db)
		await seedDatabase(db)

		const user = await db.query.users.findFirst();
		const session = await createSession(user!.id, db);
		const container = await AstroContainer.create();

		const request = new Request("http://localhost/explore", {
			headers: new Headers({
				cookie: `session=${session.token}`,
			}),
		});
		
		const response = await container.renderToResponse(Explore, {
			locals: { db },
			request
		});

		expect(response.status).toBe(200);
	});

});
