import { experimental_AstroContainer as AstroContainer } from "astro/container";
import { describe, expect, it } from "vitest";
import { z } from "astro/zod";
import FieldInput from "@src/components/FieldInput.astro";
import NewFieldInput from "@src/components/NewFieldInput.astro";
import { actions } from "astro:actions";

describe("Toast", () => {
	it("renders a configured toast", async () => {
		const container = await AstroContainer.create();
		const oldFieldInput = await container.renderToResponse(FieldInput, {
			props: {
				title: "Username",
				name: "username",
				description: "Other users use this name to find you. It must be unique",
				zodField: z.string().trim().min(3).max(30),
			},
		});

		const newFieldInput = await container.renderToResponse(NewFieldInput, {
			props: {
				action: actions.updateSettings,
				name: "username",
				title: "Username",
				description: "Other users use this name to find you. It must be unique",
			},
		});

		const oldhtml = await oldFieldInput.text()
		const newhtml = await newFieldInput.text()
		


		expect(oldhtml).toEqual(newhtml);
	});
});
