import { describe, expect, it } from "vitest";
import {
	defaultPageSize,
	firstPageFields,
	firstPageHref,
	pageNavigation,
	pageSizes,
	parsePageRequest,
	type Page,
} from "@src/pagination";

const url = (query: string) => new URL(`http://localhost/list${query}`);
const page = (overrides: Partial<Page<string>>): Page<string> => ({
	items: ["a"],
	previous: undefined,
	next: undefined,
	isPastEnd: false,
	...overrides,
});

describe("parsePageRequest", () => {
	it("reads a page after or before a cursor", () => {
		expect(parsePageRequest(url("?rows=10&after=1000"))).toEqual({ limit: 10, cursor: { after: "1000" } });
		expect(parsePageRequest(url("?before=1000"))).toEqual({ limit: defaultPageSize, cursor: { before: "1000" } });
	});

	it.each(["", "?after=", "?after=1000&before=2000"])("reads the first page for %s", (query) => {
		expect(parsePageRequest(url(query)).cursor).toBeUndefined();
	});

	it.each(pageSizes)("accepts %i rows", (size) => {
		expect(parsePageRequest(url(`?rows=${size}`)).limit).toBe(size);
	});

	it.each(["", "0", "-25", "26", "25.5", "abc", "100000"])("falls back to the default size for rows=%s", (rows) => {
		expect(parsePageRequest(url(`?rows=${rows}`)).limit).toBe(defaultPageSize);
	});
});

describe("pageNavigation", () => {
	it("links to the pages on either side, keeping the rest of the query", () => {
		const navigation = pageNavigation(
			url("?q=kebab&rows=10&after=5000"),
			page({ previous: { before: "4000" }, next: { after: "3000" } }),
		);

		expect(navigation?.rows).toBe(10);
		expect(navigation?.previousHref).toBe("/list?q=kebab&rows=10&before=4000");
		expect(navigation?.nextHref).toBe("/list?q=kebab&rows=10&after=3000");
	});

	it("keeps the cursor when the rows per page change, and leaves out the default size", () => {
		const navigation = pageNavigation(url("?rows=10&after=5000"), page({}));

		expect(navigation?.rowsOptions.map((option) => option.href)).toEqual([
			"/list?rows=10&after=5000",
			"/list?after=5000",
			"/list?rows=50&after=5000",
			"/list?rows=100&after=5000",
		]);
	});

	it("leaves out empty query values", () => {
		expect(pageNavigation(url("?q=&filter=banned"), page({ next: { after: "3" } }))?.nextHref).toBe(
			"/list?filter=banned&after=3",
		);
	});

	it("still links back from an empty page past the end", () => {
		const navigation = pageNavigation(url("?after=5000"), page({ items: [], previous: { before: "5000" }, isPastEnd: true }));

		expect(navigation?.previousHref).toBe("/list?before=5000");
	});

	it("has nothing to page through in an empty list", () => {
		expect(pageNavigation(url(""), page({ items: [] }))).toBeUndefined();
	});
});

describe("firstPageHref", () => {
	it("changes the query and starts again from the first page", () => {
		expect(firstPageHref(url("?q=kebab&rows=10&after=3"), { filter: "banned" })).toBe("/list?q=kebab&rows=10&filter=banned");
		expect(firstPageHref(url("?filter=banned&before=3"), { filter: undefined })).toBe("/list");
	});
});

describe("firstPageFields", () => {
	it("keeps the values a form does not change, without the cursor", () => {
		expect(firstPageFields(url("?q=kebab&filter=banned&rows=10&after=3"), { q: undefined })).toEqual([
			["filter", "banned"],
			["rows", "10"],
		]);
	});
});
