import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

// The rules of AGENTS.md that a reader of the code can check. Each test lists the files that break its rule.

const root = fileURLToPath(new URL("../..", import.meta.url));
const src = join(root, "src");

// Every file under a folder, as a path from the root of the project.
function filesIn(folder: string): string[] {
	return readdirSync(join(root, folder), { recursive: true, encoding: "utf8" })
		.map((path) => join(folder, path))
		.filter((path) => statSync(join(root, path)).isFile());
}

function read(path: string) {
	return readFileSync(join(root, path), "utf8");
}

function breaking(paths: string[], pattern: RegExp) {
	return paths.filter((path) => pattern.test(read(path)));
}

const sourceFiles = filesIn("src").filter((path) => !path.startsWith(join("src", "tests")));
const astroFiles = sourceFiles.filter((path) => path.endsWith(".astro"));
const testFiles = filesIn(join("src", "tests"));

describe("the browser", () => {
	it("runs no JavaScript of the site", () => {
		// A script the browser runs, other than the rules of the Speculation API, which are JSON.
		const script = /<script(?![^>]*type="speculationrules")/;
		// An island, which Astro hydrates with JavaScript.
		const island = /\bclient:[a-z]+/;
		// An event handler in an attribute, such as onclick.
		const handler = /\son[a-z]+\s*=/;

		expect(breaking(astroFiles, script)).toEqual([]);
		expect(breaking(astroFiles, island)).toEqual([]);
		expect(breaking(astroFiles, handler)).toEqual([]);
		expect(filesIn("public").filter((path) => /\.(m?js|ts)$/.test(path))).toEqual([]);
	});
});

describe("the markup", () => {
	it("uses the semantic tokens and leaves the primitives to styles.css", () => {
		const outsideStyles = sourceFiles.filter((path) => path !== join("src", "styles.css"));
		const primitive = /--(pr|ds)-/;
		// A colour of its own, such as bg-[#fff] or text-[oklch(…)].
		const arbitraryColour = /-\[(#|rgba?\(|hsla?\(|oklch\(|oklab\(|color-mix\()/;
		// A colour of the default palette of Tailwind, such as text-red-500.
		const paletteColour =
			/\b(bg|text|border|ring|outline|fill|stroke|from|via|to|shadow|decoration|accent|caret|divide|placeholder)-(slate|gray|zinc|neutral|stone|red|orange|amber|yellow|lime|green|emerald|teal|cyan|sky|blue|indigo|violet|purple|fuchsia|pink|rose)-\d{2,3}\b|\b(bg|text|border|fill|stroke)-(white|black)\b/;

		expect(breaking(outsideStyles, primitive)).toEqual([]);
		expect(breaking(astroFiles, arbitraryColour)).toEqual([]);
		expect(breaking(astroFiles, paletteColour)).toEqual([]);
	});
});

describe("the tests", () => {
	it("live in src/tests", () => {
		const outside = [...filesIn("src"), ...filesIn("tools")].filter(
			(path) => /\.(test|spec)\.ts$/.test(path) && !path.startsWith(join("src", "tests")),
		);

		expect(outside).toEqual([]);
	});

	it("use the real code, not mocks", () => {
		const mock = /\bvi\.(mock|doMock|unmock|fn|spyOn|stubGlobal|stubEnv|mocked|hoisted)\b/;

		expect(breaking(testFiles, mock)).toEqual([]);
	});
});

describe("the folders of src", () => {
	it("are the features of CONTEXT.md and the places no feature owns", () => {
		const features = ["admin", "auth", "cities", "follows", "map", "notifications", "pictures", "privacy", "restaurants", "reviews", "settings", "users"];
		const shared = ["actions", "components", "db", "layouts", "middleware", "pages", "tests"];
		const folders = readdirSync(src, { withFileTypes: true })
			.filter((entry) => entry.isDirectory())
			.map((entry) => entry.name);

		expect(folders.toSorted()).toEqual([...features, ...shared].toSorted());
	});
});
