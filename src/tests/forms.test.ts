import { describe, expect, it } from "vitest";
import { answerFormOfVisitor, formPage } from "@src/middleware/forms";

const origin = "http://localhost:4321";

function form(pathname: string, referer?: string) {
	return new Request(`${origin}${pathname}?_action=profile.follow`, {
		method: "POST",
		headers: referer === undefined ? {} : { Referer: referer },
	});
}

describe("a form sent by someone who is logged out", () => {
	it("sends them to log in, tells them why, and brings them back to the page of the form", () => {
		const response = answerFormOfVisitor(formPage(form("/bob/profile", `${origin}/bob/profile?tab=favorites`), origin, "/bob/profile"));

		expect(response.status).toBe(302);
		expect(response.headers.get("Location")).toBe(`/login?reason=logged-out&next=${encodeURIComponent("/bob/profile?tab=favorites")}`);
		expect(response.headers.get("Clear-Site-Data")).toContain("prerenderCache");
	});

	it("leads back to the address of the form without a Referer, and to the Feed when that address is another site", () => {
		expect(formPage(form("/bob/profile"), origin, "/bob/profile")).toBe("/bob/profile");
		expect(formPage(form("/bob/profile", "https://evil.example/"), origin, "/bob/profile")).toBe("/bob/profile");
		expect(formPage(form("/x"), origin, "//evil.example")).toBe("/feed");
	});
});
