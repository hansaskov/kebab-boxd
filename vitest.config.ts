import { getViteConfig } from "astro/config";
import { defineConfig } from "vitest/config";

export default defineConfig(async (env) => {
	const astroConfigFn = getViteConfig({});
	const astroConfig = await astroConfigFn(env);
	return {
		...astroConfig,
		test: {
			environment: "node",
			testTimeout: 60000,
			isolate: false,
			// Each worker starts Miniflare, which stops its workerd process when the process of the worker exits.
			// A worker thread ends without that exit, so with threads every run would leave workerd processes behind.
			pool: "forks",
			fileParallelism: true,
		},
	};
});
