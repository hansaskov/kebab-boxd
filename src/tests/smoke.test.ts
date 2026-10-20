import { experimental_AstroContainer as AstroContainer } from 'astro/container';
import { describe, it, expect  } from "vitest";
import Explore from "@src/pages/explore.astro"
import { createDrizzleDatabase, migrateDrizzleDatabase } from '@src/db/index';

describe("GET /explore (unauthenticated)", () => {

	it("redirects to /login when no session cookie is present", async () => {
		const db = createDrizzleDatabase("file:test?mode=memory");
		migrateDrizzleDatabase(db)

		const container = await AstroContainer.create();
		const response = await container.renderToResponse(Explore, {locals: { db, session: null }})

		expect(response.status).toBe(302);
		expect(response.headers.get("Location")).toBe("/login");
	});

});
