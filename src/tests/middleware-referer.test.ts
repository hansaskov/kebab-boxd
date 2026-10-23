import { describe, expect, it } from "vitest";
import { sameOriginReferer } from "@src/middleware/referer";

const origin = "http://localhost:4321";

function from(referer?: string) {
	return new Request(`${origin}/bob/profile?_action=profile.follow`, {
		method: "POST",
		headers: referer === undefined ? {} : { Referer: referer },
	});
}

describe("sameOriginReferer", () => {
	it("returns the page and query the form was sent from", () => {
		expect(sameOriginReferer(from(`${origin}/bob/profile?tab=favorites&after=1700000000.3`), origin)).toBe(
			"/bob/profile?tab=favorites&after=1700000000.3",
		);
	});

	it("ignores a page on another site", () => {
		expect(sameOriginReferer(from("https://example.com/bob/profile"), origin)).toBeUndefined();
		expect(sameOriginReferer(from("http://localhost:4322/bob/profile"), origin)).toBeUndefined();
	});

	it("ignores a missing or broken Referer", () => {
		expect(sameOriginReferer(from(), origin)).toBeUndefined();
		expect(sameOriginReferer(from("not a url"), origin)).toBeUndefined();
	});
});
