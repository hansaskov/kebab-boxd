import { experimental_AstroContainer as AstroContainer } from "astro/container";
import { describe, expect, it } from "vitest";
import SpeculationsAPI from "@src/components/SpeculationsAPI.astro";

describe("SpeculationsAPI", () => {
	it("never prerenders API routes, so hovering a link cannot sign out, start a sign-in or a download", async () => {
		const container = await AstroContainer.create();

		const html = await container.renderToString(SpeculationsAPI, { props: { prefetchUrls: [] } });

		expect(html).toContain(`{"not":{"href_matches":"/api/*"}}`);
	});
});
