import { describe, expect, it } from "vitest";
import { parseUserListCriteria, searchMaxLength } from "@src/validation/user-list-criteria";

const parse = (query: string) => parseUserListCriteria(new URLSearchParams(query));

describe("parseUserListCriteria", () => {
	it("reads the search and the filter", () => {
		expect(parse("q=kebab&filter=banned")).toEqual({ search: "kebab", filter: "banned" });
	});

	it("lists every user without either, or for a filter not on offer", () => {
		expect(parse("")).toEqual({ search: "", filter: "all" });
		expect(parse("filter=everyone")).toEqual({ search: "", filter: "all" });
	});

	it("trims the search and cuts it to the longest length allowed", () => {
		expect(parse("q=  kebab  ").search).toBe("kebab");
		expect(parse(`q=${"k".repeat(searchMaxLength + 5)}`).search).toHaveLength(searchMaxLength);
	});
});
