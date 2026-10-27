import { describe, expect, it } from "vitest";
import { cursorList } from "@src/db/pagination";

describe("cursorList", () => {
	it("refuses to order by several columns when one of them is text", () => {
		expect(() => cursorList("history", ["requestedAt", "path"], "desc")).toThrow(
			"A cursor list ordered by several columns can only use number columns.",
		);
	});
});
