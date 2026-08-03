import { experimental_AstroContainer as AstroContainer } from "astro/container";
import { describe, expect, it } from "vitest";
import Toast from "@src/components/Toast.astro";

describe("Toast", () => {
	it("renders a configured toast", async () => {
		const container = await AstroContainer.create();
		const response = await container.renderToResponse(Toast, {
			props: {
				toast: {
					title: "Saved",
					text: "Your profile was updated.",
				},
			},
		});
		const html = await response.text();

		expect(html).toContain("Saved");
		expect(html).toContain("Your profile was updated.");
	});
});
