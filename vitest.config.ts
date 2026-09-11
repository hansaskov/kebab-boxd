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
			pool: "threads",
			fileParallelism: true, 
		},
	};
});
