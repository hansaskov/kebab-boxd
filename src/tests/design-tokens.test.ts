import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const css = readFileSync(new URL("../styles.css", import.meta.url), "utf8");

function colorTokens(selector: string): string[] {
	const start = css.indexOf(`${selector} {`);
	expect(start, `no rule for ${selector}`).toBeGreaterThanOrEqual(0);
	const body = css.slice(css.indexOf("{", start) + 1, css.indexOf("}", start));
	return [...body.matchAll(/(--ds-color-[\w-]+)\s*:/g)].map((match) => match[1] ?? "").toSorted();
}

describe("the design tokens", () => {
	it("give every colour a value in both themes", () => {
		expect(colorTokens('[data-theme="dark"]')).toEqual(colorTokens('[data-theme="light"]'));
	});
});
