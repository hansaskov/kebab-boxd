import { experimental_AstroContainer as AstroContainer } from "astro/container";
import { describe, expect, it } from "vitest";
import DialogDrawer from "@src/components/DialogDrawer.astro";

async function renderDialogDrawer(props: { open?: boolean; description?: string }) {
	const container = await AstroContainer.create();
	return container.renderToString(DialogDrawer, {
		props: { id: "confirm", title: "Are you sure?", ...props },
		slots: { default: "<p>Body</p>" },
	});
}

describe("DialogDrawer", () => {
	it("renders a closed dialog named by its title and description", async () => {
		const html = await renderDialogDrawer({ description: "This cannot be undone." });

		expect(html).toMatch(/<dialog id="confirm" class="dialog-drawer" closedby="any" aria-labelledby="confirm-title" aria-describedby="confirm-description">/);
		expect(html).toContain(`<h2 id="confirm-title" class="t-subheading">Are you sure?</h2>`);
		expect(html).toContain(`<p id="confirm-description" class="t-body-sm text-fg-muted">This cannot be undone.</p>`);
		expect(html).toContain("<p>Body</p>");
	});

	it("closes from both the dialog close button and the drawer cancel button", async () => {
		const html = await renderDialogDrawer({});

		expect(html.match(/commandfor="confirm" command="close"/g)).toHaveLength(2);
		expect(html).not.toContain("aria-describedby");
	});

	it("can be rendered open, so the server can show it again with errors", async () => {
		const html = await renderDialogDrawer({ open: true });

		expect(html).toMatch(/<dialog id="confirm"[^>]*\sopen/);
	});
});
