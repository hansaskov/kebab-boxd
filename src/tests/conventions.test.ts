import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { getLeadingCommentRanges, getTrailingCommentRanges, type Node } from "typescript/ast";
import { API } from "typescript/sync";
import { describe, expect, it } from "vitest";

const root = fileURLToPath(new URL("../..", import.meta.url));
const src = join(root, "src");

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
		const script = /<script(?![^>]*type="speculationrules")/;
		const island = /\bclient:[a-z]+/;
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
		const arbitraryColour = /-\[(#|rgba?\(|hsla?\(|oklch\(|oklab\(|color-mix\()/;
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

describe("the code", () => {
	it("has no comments in the markup, the styles or the tests, which oxlint does not read", () => {
		const markup = (path: string) => read(path).replace(/^---\n[\s\S]*?\n---/, "");
		const htmlComment = /<!--|\{\/\*/;
		const cssComment = /\/\*/;
		const styles = (path: string) => [...markup(path).matchAll(/<style[^>]*>([\s\S]*?)<\/style>/g)].map((match) => match[1] ?? "").join("");

		expect(astroFiles.filter((path) => htmlComment.test(markup(path)) || cssComment.test(styles(path)))).toEqual([]);
		expect(sourceFiles.filter((path) => path.endsWith(".css") && cssComment.test(read(path)))).toEqual([]);
		expect(testFiles.filter((path) => path.endsWith(".ts") && hasComment(read(path)))).toEqual([]);
	});
});

function hasComment(text: string) {
	using api = new API();
	using parsed = api.createSourceFile("file.ts", text);
	const file = parsed.sourceFile;
	const commentsAround = (node: Node): boolean =>
		Boolean(getLeadingCommentRanges(text, node.pos)?.length || getTrailingCommentRanges(text, node.end)?.length) ||
		node.getChildren(file).some(commentsAround);

	return commentsAround(file);
}
