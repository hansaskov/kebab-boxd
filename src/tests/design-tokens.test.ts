import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const css = readFileSync(new URL("../styles.css", import.meta.url), "utf8");

function declarations(selector: string): Map<string, string> {
	const start = css.indexOf(`${selector} {`);
	expect(start, `no rule for ${selector}`).toBeGreaterThanOrEqual(0);
	const body = css.slice(css.indexOf("{", start) + 1, css.indexOf("}", start));
	const entries = new Map<string, string>();
	for (const [, name = "", value = ""] of body.matchAll(/(--[\w-]+)\s*:\s*([^;]+);/g)) {
		entries.set(name, value.trim());
	}
	return entries;
}

const primitives = declarations(":root");
const themes = {
	light: declarations('[data-theme="light"]'),
	dark: declarations('[data-theme="dark"]'),
};

function colorTokens(theme: Map<string, string>): string[] {
	return [...theme.keys()].filter((name) => name.startsWith("--ds-color-")).sort();
}

function oklch(theme: Map<string, string>, token: string) {
	const reference = theme.get(token)?.match(/^var\((--pr-[\w-]+)\)$/)?.[1];
	const value = reference && primitives.get(reference);
	const match = value?.match(/^oklch\(([\d.]+)(%?)\s[^/)]+(?:\/\s*([\d.]+)(%?))?\)$/);
	if (!match) {
		throw new Error(`${token} does not resolve to an oklch primitive`);
	}
	const [, lightness, lightnessPercent, alpha = "1", alphaPercent] = match;
	return {
		lightness: Number(lightness) / (lightnessPercent ? 100 : 1),
		alpha: Number(alpha) / (alphaPercent ? 100 : 1),
	};
}

describe("design tokens", () => {
	it("gives every colour token a value in both themes", () => {
		expect(colorTokens(themes.dark)).toEqual(colorTokens(themes.light));
	});

	it.each(Object.entries(themes))("builds every %s colour from a primitive", (_, theme) => {
		for (const name of colorTokens(theme)) {
			const reference = theme.get(name)?.match(/^var\((--pr-[\w-]+)\)$/)?.[1];
			expect(
				reference !== undefined && primitives.has(reference),
				`${name} must be a single var() of a defined --pr-* primitive`,
			).toBe(true);
		}
	});

	it("makes dark backgrounds lighter as they rise, with recessed areas above the page", () => {
		const page = oklch(themes.dark, "--ds-color-bg-page").lightness;
		const subtle = oklch(themes.dark, "--ds-color-bg-subtle").lightness;
		const surface = oklch(themes.dark, "--ds-color-bg-surface").lightness;
		const active = oklch(themes.dark, "--ds-color-bg-active").lightness;

		expect(page).toBeLessThan(subtle);
		expect(subtle).toBeLessThan(surface);
		expect(surface).toBeLessThan(active);
	});

	it("makes the strong dark border more visible than the subtle one", () => {
		const subtle = oklch(themes.dark, "--ds-color-border-subtle").alpha;
		const strong = oklch(themes.dark, "--ds-color-border-strong").alpha;

		expect(strong).toBeGreaterThan(subtle);
	});
});
