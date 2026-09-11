import { experimental_AstroContainer as AstroContainer } from "astro/container";
import { describe, expect, it } from "vitest";
import Toast from "@src/components/Toast.astro";

describe("Toast", () => {
	it("renders a configured toast", async () => {
		const container = await AstroContainer.create();
		const response = await container.renderToResponse(Toast, {
			props: {
				toast: {
					kind: "title",
					title: "Saved",
					text: "Your profile was updated.",
				},
			},
		});
		const html = await response.text();

		expect(html).toContain("Saved");
		expect(html).toContain("Your profile was updated.");
		expect(html).toContain('role="status"');
		expect(html).not.toContain("border-danger");
	});

	it("renders an error toast with the danger styling and an assertive live region", async () => {
		const container = await AstroContainer.create();
		const response = await container.renderToResponse(Toast, {
			props: {
				toast: {
					kind: "title",
					variant: "error",
					title: "Submission failed",
					text: "Something went wrong.",
				},
			},
		});
		const html = await response.text();

		expect(html).toContain("Submission failed");
		expect(html).toContain("border-danger");
		expect(html).toContain("text-danger");
		expect(html).toContain('role="alert"');
		expect(html).toContain('aria-live="assertive"');
	});
});
