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
});
