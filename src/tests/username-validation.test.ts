import { describe, expect, it } from "vitest";
import { usernameSchema } from "@src/validation/username";
import { getConstraintsFromZodSchmea } from "@src/validation/constraint";

describe("usernameSchema", () => {
	it("stores usernames in lowercase", () => {
		expect(usernameSchema.parse("Kebab_King99")).toBe("kebab_king99");
	});

	it.each(["kebab-king", "kebab king", "kebab#1", "kebåb", "kebаb", "kebab.king"])(
		"rejects characters outside A–Z, 0–9 and underscore: %s",
		(username) => {
			expect(usernameSchema.safeParse(username).success).toBe(false);
		},
	);

	it.each(["admin", "Admin", "API", "login", "settings"])(
		"rejects the reserved username %s in any letter case",
		(username) => {
			const result = usernameSchema.safeParse(username);

			expect(result.success).toBe(false);
			expect(result.error?.issues.at(0)?.message).toBe("This username is reserved.");
		},
	);

	it("allows a username that only contains a reserved name", () => {
		expect(usernameSchema.parse("admin_fan")).toBe("admin_fan");
	});

	it("gives the browser the same character rule as the server", () => {
		expect(getConstraintsFromZodSchmea(usernameSchema)).toMatchObject({
			pattern: "^[A-Za-z0-9_]+$",
			minlength: 3,
			maxlength: 30,
			required: true,
		});
	});
});
