import { describe, expect, it } from "vitest";
import { cursorList } from "@src/db/pagination";
import * as s from "@src/db/schema";

describe("cursorList", () => {
	it("refuses to order by several columns when one of them is text", () => {
		expect(() => cursorList(s.history, ["requestedAt", "path"], "desc")).toThrow(
			"A cursor list ordered by several columns can only use integer columns.",
		);
	});
});
