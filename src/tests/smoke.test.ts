import { experimental_AstroContainer as AstroContainer } from 'astro/container';
import { describe, it, expect  } from "vitest";
import Explore from "../pages/explore.astro"
import { createDatabase, migrateDatabase } from '@db/index';

describe("GET /explore (unauthenticated)", () => {

	it("redirects to /login when no session cookie is present", async () => {
		const db = createDatabase("file:test?mode=memory");
		migrateDatabase(db)

		const container = await AstroContainer.create();
		const response = await container.renderToResponse(Explore, {locals: { db }})

		expect(response.status).toBe(302);
		expect(response.headers.get("Location")).toBe("/login");
	});
});
