import { describe, expect, it } from "vitest";
import { defaultPageSize, pageSizes, parsePageSize } from "@src/validation/page-size";

describe("parsePageSize", () => {
	it.each(pageSizes)("accepts %i rows", (size) => {
		expect(parsePageSize(String(size))).toBe(size);
	});

	it.each([null, "", "0", "-25", "26", "25.5", "abc", "100000"])("falls back to the default for %s", (value) => {
		expect(parsePageSize(value)).toBe(defaultPageSize);
	});
});
