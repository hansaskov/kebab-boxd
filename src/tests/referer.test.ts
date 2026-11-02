import { describe, expect, it } from "vitest";
import { sameOriginReferer } from "@src/middleware/referer";

const origin = "http://localhost:4321";

function from(referer?: string) {
	return new Request(`${origin}/bob/profile?_action=profile.follow`, {
		method: "POST",
		headers: referer === undefined ? {} : { Referer: referer },
	});
}

describe("the page a form was sent from", () => {
	it("is the page and query on this site, and nothing on another site or in a broken Referer", () => {
		expect(sameOriginReferer(from(`${origin}/bob/profile?tab=favorites&after=1700000000.3`), origin)).toBe(
			"/bob/profile?tab=favorites&after=1700000000.3",
		);
		for (const referer of ["https://example.com/bob/profile", "http://localhost:4322/bob/profile", "not a url", undefined]) {
			expect(sameOriginReferer(from(referer), origin), referer).toBeUndefined();
		}
	});
});
