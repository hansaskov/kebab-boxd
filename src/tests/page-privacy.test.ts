import { experimental_AstroContainer as AstroContainer } from "astro/container";
import { DATA_CONTROLLER_EMAIL, DATA_CONTROLLER_NAME } from "astro:env/server";
import { describe, expect, it } from "vitest";
import PrivacyPage from "@src/pages/privacy.astro";
import SpeculationsAPI from "@src/components/SpeculationsAPI.astro";
import { createSession, getSession, sessionCookieName } from "@src/auth/session";
import { googleCookieNames } from "@src/auth/providers/google";
import type { Database } from "@src/db";
import { createTestDatabase, insertUser } from "@src/tests/database";

async function renderPrivacyPage(db: Database, viewerSessionId: string | null) {
	const container = await AstroContainer.create();
	const response = await container.renderToResponse(PrivacyPage, {
		locals: { db, session: viewerSessionId ? await getSession(viewerSessionId, db) : null },
		request: new Request("http://localhost/privacy"),
	});
	return { response, html: await response.text() };
}

describe("PrivacyPage", () => {
	it("tells a visitor who is responsible, which cookies we set and how long we keep data", async () => {
		const { db } = createTestDatabase("privacy-anonymous");

		const { response, html } = await renderPrivacyPage(db, null);

		expect(response.status).toBe(200);
		expect(html).toContain(DATA_CONTROLLER_NAME);
		expect(html).toContain(`mailto:${DATA_CONTROLLER_EMAIL}`);
		expect(html).toContain(sessionCookieName);
		expect(html).toContain(googleCookieNames.state);
		expect(html).toContain(googleCookieNames.codeVerifier);
		expect(html).toContain("30 days after its last use");
		expect(html).toContain("90 days");
		expect(html).not.toContain("/settings#");
	});

	it("links a signed-in user to the settings where they can use their rights", async () => {
		const { client, db } = createTestDatabase("privacy-signed-in");
		const ada = insertUser(client, "ada");
		const session = await createSession(ada.id, db);

		const { html } = await renderPrivacyPage(db, session.id);

		expect(html).toContain(`href="/ada/settings#your-data"`);
		expect(html).toContain(`href="/ada/settings#danger-zone"`);
	});
});

describe("SpeculationsAPI", () => {
	it("never prerenders API routes, so hovering a link cannot start a sign-in or a download", async () => {
		const container = await AstroContainer.create();

		const html = await container.renderToString(SpeculationsAPI, { props: { prefetchUrls: [] } });

		expect(html).toContain(`{"not":{"href_matches":"/api/*"}}`);
	});
});
