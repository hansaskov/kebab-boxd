import { getViteConfig } from "astro/config";
import { configDefaults, defineConfig } from "vitest/config";

export default defineConfig(async (env) => {
	const astroConfigFn = getViteConfig({});
	const astroConfig = await astroConfigFn(env);
	return {
		...astroConfig,
		test: {
			environment: "node",
			// The end-to-end tests ask GeoNames, Overpass and Nominatim, so they run only with `pnpm test:e2e`.
			exclude: [...configDefaults.exclude, ...(process.env["E2E"] ? [] : ["src/tests/e2e/**"])],
			testTimeout: 60000,
			isolate: false,
			// Each worker starts Miniflare, which stops its workerd process when the process of the worker exits.
			// A worker thread ends without that exit, so with threads every run would leave workerd processes behind.
			pool: "forks",
			fileParallelism: true,
		},
	};
});
