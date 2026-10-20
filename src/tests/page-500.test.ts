import { experimental_AstroContainer as AstroContainer } from "astro/container";
import { describe, expect, it } from "vitest";
import ErrorPage from "@src/pages/500.astro";

describe("500 page", () => {
	it("shows a generic message instead of the error details", async () => {
		const container = await AstroContainer.create();

		const response = await container.renderToResponse(ErrorPage, {
			props: { error: new Error("SQLITE_ERROR: no such table: secret_internals") },
		});
		const html = await response.text();

		expect(html).toContain("Something went wrong on our side.");
		expect(html).not.toContain("secret_internals");
	});
});
