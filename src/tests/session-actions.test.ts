import type { APIContext } from "astro";
import { experimental_AstroContainer as AstroContainer } from "astro/container";
import { describe, expect, it } from "vitest";
import { server } from "@src/actions/index";
import { getSession, sessionCookieName } from "@src/auth/session";
import { actionContext, form } from "@src/tests/actions";
import { renderEndpoint } from "@src/tests/container";
import { createTestDatabase, insertUser, signIn } from "@src/tests/database";

describe("toggleTheme action", () => {
	it("switches the theme of the device between light and dark", async () => {
		const { client, db } = createTestDatabase("session-theme");
		const ada = insertUser(client, "ada");
		const session = await signIn(db, ada.id);
		const toggle = async () => server.session.toggleTheme.call(actionContext(db, await getSession(session.id, db)), form({}));

		await toggle();
		expect((await getSession(session.id, db))?.theme).toBe("dark");

		await toggle();
		expect((await getSession(session.id, db))?.theme).toBe("light");
	});
});

describe("signOut action", () => {
	it("signs out this device only, clears the session cookie and sends the user to the login page", async () => {
		const { client, db } = createTestDatabase("session-sign-out");
		const ada = insertUser(client, "ada");
		const session = await signIn(db, ada.id);
		const other = await signIn(db, ada.id);
		const endpoint = {
			POST: async (context: APIContext) => {
				Reflect.set(context, Symbol.for("astro.actionAPIContext"), true);
				const result = await server.session.signOut.call(context, form({}));
				return Response.json({ data: result.data, setCookies: [...context.cookies.headers()] });
			},
		};

		const response = await renderEndpoint(await AstroContainer.create(), endpoint, {
			locals: { db, session },
			request: new Request("http://localhost/", { method: "POST" }),
		});

		const { data, setCookies } = await response.json();
		expect(data).toEqual({ redirect: "/login" });
		expect(setCookies).toEqual([expect.stringMatching(new RegExp(`^${sessionCookieName}=;.*Max-Age=0`))]);
		expect(await getSession(session.id, db)).toBeNull();
		expect(await getSession(other.id, db)).not.toBeNull();
	});
});
