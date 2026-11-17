import { getViteConfig } from "astro/config";
import { configDefaults, defineConfig } from "vitest/config";

export default defineConfig(async (env) => {
	const astroConfigFn = getViteConfig({});
	const astroConfig = await astroConfigFn(env);
	return {
		...astroConfig,
		test: {
			environment: "node",
			exclude: [...configDefaults.exclude, ...(process.env["E2E"] ? [] : ["src/tests/e2e/**"])],
			testTimeout: 60000,
			isolate: false,
			pool: "forks",
			fileParallelism: true,
		},
	};
});
