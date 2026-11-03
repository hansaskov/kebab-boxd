import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const css = readFileSync(new URL("../styles.css", import.meta.url), "utf8");

// The innermost rules of the stylesheet, each with its selector and declarations. An at-rule such as
// @layer or @media around a rule is not part of its selector.
const rules = [...css.replaceAll(/\/\*[\s\S]*?\*\//g, "").matchAll(/([^{}]+)\{([^{}]*)\}/g)].map(
	([, selector = "", declarations = ""]) => ({ selector: selector.trim().replaceAll(/\s+/g, " "), declarations }),
);

function colorTokens(selector: string): string[] {
	const start = css.indexOf(`${selector} {`);
	expect(start, `no rule for ${selector}`).toBeGreaterThanOrEqual(0);
	const body = css.slice(css.indexOf("{", start) + 1, css.indexOf("}", start));
	return [...body.matchAll(/(--ds-color-[\w-]+)\s*:/g)].map((match) => match[1] ?? "").toSorted();
}

// The value of a token, following each var() it refers to.
function tokenValue(name: string): string {
	const value = css.match(new RegExp(`${name}\\s*:\\s*([^;]+);`))?.[1]?.trim();
	expect(value, `no value for ${name}`).toBeDefined();
	const reference = value?.match(/^var\((--[\w-]+)\)$/)?.[1];
	return reference ? tokenValue(reference) : (value ?? "");
}

function pixels(length: string): number {
	const match = length.match(/^(\d*\.?\d+)(px|rem)$/);
	expect(match, `${length} is not a length in px or rem`).not.toBeNull();
	return Number(match?.[1]) * (match?.[2] === "rem" ? 16 : 1);
}

describe("the design tokens", () => {
	it("give every colour a value in both themes", () => {
		expect(colorTokens('[data-theme="dark"]')).toEqual(colorTokens('[data-theme="light"]'));
	});

	it("keep the text of form controls large enough that a phone does not zoom in on them", () => {
		expect(pixels(tokenValue("--ds-fs-control"))).toBeGreaterThanOrEqual(16);

		const controlRule = rules.find((rule) => rule.selector === "input, select, textarea");
		expect(controlRule?.declarations).toMatch(/font-size:\s*var\(--ds-fs-control\);/);

		const otherSizes = rules
			.filter((rule) => rule !== controlRule)
			.filter((rule) => /(^|[\s,(>+~])(input|select|textarea)\b|\.(input|dropzone-input)\b/.test(rule.selector))
			.filter((rule) => /font(-size)?\s*:(?!\s*inherit\s*;)/.test(rule.declarations))
			.map((rule) => rule.selector);
		expect(otherSizes).toEqual([]);
	});
});
