import { defineConfig, envField } from "astro/config";
import tailwindcss from "@tailwindcss/vite";
import cloudflare from "@astrojs/cloudflare";
import { cacheCloudflare } from "@astrojs/cloudflare/cache";

export default defineConfig({
  site: "https://kebab.hjemmet.net",
  output: "server",
  build: {
    inlineStylesheets: "always",
  },
  vite: {
    plugins: [tailwindcss()],
  },
  cache: {
    provider: cacheCloudflare(),
  },
  session: false,
  security: {
    // Room for the four pictures a review can have, at most 10 MB each.
    actionBodySizeLimit: 41 * 1024 * 1024,
  },
  // SST writes the Wrangler config with the bindings of the Worker and gives its path here. The tests render
  // the pages in Node, where the Vite server of the adapter would clash with the one of Vitest.
  adapter: process.env.VITEST
    ? undefined
    : cloudflare({
        configPath: process.env.SST_WRANGLER_PATH,
        // The site has no images for Astro to transform, so the Worker needs no binding for it.
        imageService: "passthrough",
      }),
  env: {
    schema: {
      GOOGLE_CLIENT_ID: envField.string({ context: "server", access: "secret" }),
      GOOGLE_CLIENT_SECRET: envField.string({ context: "server", access: "secret" }),
      GOOGLE_REDIRECT_URI: envField.string({ context: "server", access: "secret" }),
      DATA_CONTROLLER_NAME: envField.string({ context: "server", access: "secret" }),
      DATA_CONTROLLER_EMAIL: envField.string({ context: "server", access: "secret" }),
      // The User who becomes the first Admin of a stage by signing in with this verified email address.
      BOOTSTRAP_ADMIN_EMAIL: envField.string({ context: "server", access: "secret", optional: true }),
    },
  },
});
