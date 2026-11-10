import { describe, expect, it } from "vitest";
import { starFills } from "@src/format/rating";

describe("starFills", () => {
	it("shows the lowest rating as one full star and four empty ones", () => {
		expect(starFills(2)).toEqual(["full", "empty", "empty", "empty", "empty"]);
	});

	it("ends an odd rating in a half star", () => {
		expect(starFills(7)).toEqual(["full", "full", "full", "half", "empty"]);
	});

	it("fills every star of the highest rating", () => {
		expect(starFills(10)).toEqual(["full", "full", "full", "full", "full"]);
	});
});
