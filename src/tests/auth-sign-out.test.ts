import { describe, expect, it } from "vitest";
import { experimental_AstroContainer as AstroContainer } from "astro/container";
import * as logoutEndpoint from "@src/pages/api/logout";
import { createSession, getSession } from "@src/auth/session";
import { sessions } from "@src/db/schema";
import { createTestDatabase, insertUser } from "@src/tests/database";

describe("POST /api/logout", () => {
	it("deletes the session, sends the user to /login and clears speculative pages", async () => {
		const { client, db } = createTestDatabase("sign-out");
		const ada = insertUser(client, "ada");
		const session = await createSession(ada.id, db);
		const container = await AstroContainer.create();

		const response = await container.renderToResponse(logoutEndpoint, {
			routeType: "endpoint",
			request: new Request("https://example.test/api/logout", { method: "POST" }),
			locals: { db, session: await getSession(session.id, db) },
		});

		expect(response.status).toBe(302);
		expect(response.headers.get("Location")).toBe("/login");
		expect(response.headers.get("Cache-Control")).toBe("no-store");
		expect(response.headers.get("Clear-Site-Data")).toBe("\"prefetchCache\", \"prerenderCache\"");
		expect(await client.$count(sessions)).toBe(0);
	});
});
