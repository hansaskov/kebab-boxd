import { fileURLToPath } from "node:url";
import { build } from "esbuild";
import { describe, expect, it } from "vitest";

const entryPoint = fileURLToPath(new URL("../backend.ts", import.meta.url));

async function bundle() {
	const { metafile } = await build({
		entryPoints: [entryPoint],
		bundle: true,
		write: false,
		metafile: true,
		format: "esm",
		platform: "neutral",
		target: "es2024",
		mainFields: ["module", "main"],
		conditions: ["workerd", "worker"],
		external: ["cloudflare:*", "node:*"],
		loader: { ".sql": "text" },
		logLevel: "error",
	});
	return metafile;
}

describe("the Backend Worker", () => {
	it("leaves out the validation of forms, and stays small", async () => {
		const metafile = await bundle();
		const [output] = Object.values(metafile.outputs);

		expect(Object.keys(metafile.inputs).filter((input) => /\/(zod|astro)\//.test(input))).toEqual([]);
		expect(output!.bytes).toBeLessThan(600_000);
	});
});
