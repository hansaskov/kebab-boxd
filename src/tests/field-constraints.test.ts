import { experimental_AstroContainer as AstroContainer } from "astro/container";
import { z } from "astro/zod";
import { describe, expect, it } from "vitest";
import FieldInput from "@src/components/FieldInput.astro";
import { getConstraintsFromZodSchema } from "@src/validation/constraint";
import { usernameSchema } from "@src/validation/username";

describe("getConstraintsFromZodSchema", () => {
	it("gives the username rules to the browser, with the reason for the pattern", () => {
		expect(getConstraintsFromZodSchema(usernameSchema)).toEqual({
			minlength: 3,
			maxlength: 30,
			pattern: "^[A-Za-z0-9_]+$",
			title: "Use only letters a–Z, digits and underscores.",
			required: true,
		});
	});

	it("leaves out the title when the pattern has no message of its own", () => {
		const constraints = getConstraintsFromZodSchema(z.string().regex(/^a+$/));

		expect(constraints?.pattern).toBe("^a+$");
		expect(constraints?.title).toBeUndefined();
	});

	it("leaves out a pattern that the browser would match differently", () => {
		const constraints = getConstraintsFromZodSchema(z.string().regex(/^a+$/i, "Use only the letter a."));

		expect(constraints?.pattern).toBeUndefined();
		expect(constraints?.title).toBeUndefined();
	});
});

describe("FieldInput", () => {
	async function renderUsernameField(errors?: string[]) {
		const container = await AstroContainer.create();
		return container.renderToString(FieldInput, {
			props: {
				label: "Username",
				name: "username",
				description: "Others use it to find you.",
				type: "text",
				value: "hansasd123.,",
				zodField: usernameSchema,
				errors,
			},
		});
	}

	it("tells the browser why the username does not match", async () => {
		const html = await renderUsernameField();

		expect(html).toContain('title="Use only letters A–Z, digits and underscores."');
		expect(html).not.toContain('title="Username"');
		expect(html).toMatch(/<label[^>]*for="username"[^>]*>Username<\/label>/);
	});

	it("does not render its own props as input attributes", async () => {
		const html = await renderUsernameField();
		const input = html.match(/<input[^>]*>/)?.[0];

		expect(input).toBeDefined();
		expect(input).not.toMatch(/zodField|label=|description=|errors=/);
	});

	it("links the description and errors to the input", async () => {
		const html = await renderUsernameField(["Username is already taken."]);
		const input = html.match(/<input[^>]*>/)?.[0];

		expect(input).toContain('aria-describedby="username-description username-error"');
		expect(input).toContain('aria-invalid="true"');
		expect(html).toMatch(/<p id="username-error"[^>]*>Username is already taken\.<\/p>/);
	});
});
