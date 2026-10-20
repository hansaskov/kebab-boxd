import { experimental_AstroContainer as AstroContainer } from "astro/container";
import { describe, expect, it } from "vitest";
import * as themeEndpoint from "@src/pages/api/theme";
import { createSession, getSession } from "@src/auth/session";
import { createDrizzleDatabase, migrateDrizzleDatabase } from "@src/db";
import { users } from "@src/db/schema";

// The container renders endpoint modules with `routeType: "endpoint"`, but its
// parameter type only names Astro components.
type Renderable = Parameters<AstroContainer["renderToResponse"]>[0];

describe("POST /api/theme", () => {
	it("toggles the theme and only clears speculatively loaded pages", async () => {
		const db = createDrizzleDatabase("file:api-theme?mode=memory");
		migrateDrizzleDatabase(db);
		const user = db
			.insert(users)
			.values({ fullname: "First User", username: "first_1", email: "first@example.com" })
			.returning()
			.get();
		const session = await createSession(user.id, db);
		const container = await AstroContainer.create();

		const response = await container.renderToResponse(themeEndpoint as unknown as Renderable, {
			routeType: "endpoint",
			request: new Request("http://localhost/api/theme", {
				method: "POST",
				headers: { Referer: "http://localhost/explore" },
			}),
			locals: { db, session: await getSession(session.id, db) },
		});

		expect(response.status).toBe(302);
		expect(response.headers.get("Location")).toBe("http://localhost/explore");
		expect(response.headers.get("Clear-Site-Data")).toBe('"prefetchCache", "prerenderCache"');
		expect((await getSession(session.id, db))?.theme).toBe("dark");
	});
});
