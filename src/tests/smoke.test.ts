import { experimental_AstroContainer as AstroContainer } from 'astro/container';
import { describe, it, expect  } from "vitest";
import Explore from "@src/pages/explore.astro"
import { createTestDatabase } from "@src/tests/database";

describe("GET /explore (unauthenticated)", () => {

	it("redirects to /login when no session cookie is present", async () => {
		const { db } = createTestDatabase("smoke-explore");

		const container = await AstroContainer.create();
		const response = await container.renderToResponse(Explore, {locals: { db, session: null }})

		expect(response.status).toBe(302);
		expect(response.headers.get("Location")).toBe("/login");
	});

});
