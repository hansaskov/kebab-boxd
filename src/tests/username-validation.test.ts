import { describe, expect, it } from "vitest";
import { usernameSchema } from "@src/validation/username";

describe("usernameSchema", () => {
	it("rejects a reserved username in any letter case", () => {
		const result = usernameSchema.safeParse("Admin");

		expect(result.success).toBe(false);
		expect(result.error?.issues.at(0)?.message).toBe("This username is reserved.");
	});
});
