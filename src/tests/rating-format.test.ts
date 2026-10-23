import { describe, expect, it } from "vitest";
import { formatAverageStars, splitStars } from "@src/format/rating";

describe("splitStars", () => {
	it("shows every rating from one star to five stars in half-star steps", () => {
		expect([2, 3, 9, 10].map(splitStars)).toEqual([
			{ full: 1, half: false },
			{ full: 1, half: true },
			{ full: 4, half: true },
			{ full: 5, half: false },
		]);
	});
});

describe("formatAverageStars", () => {
	it("shows the average in stars with one decimal", () => {
		expect(formatAverageStars(8.666)).toBe("4.3");
	});
});
