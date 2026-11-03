import { defineConfig, envField } from "astro/config";
import tailwindcss from "@tailwindcss/vite";
import cloudflare from "@astrojs/cloudflare";
import { cacheCloudflare } from "@astrojs/cloudflare/cache";

export default defineConfig({
  site: "https://kebab.hjemmet.net",
  output: "server",
  devToolbar: {
    enabled: false
  },
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
    actionBodySizeLimit: 41 * 1024 * 1024,
  },
  adapter: process.env.VITEST
    ? undefined
    : cloudflare({
        configPath: process.env.SST_WRANGLER_PATH,
        imageService: "passthrough",
      }),
  env: {
    schema: {
      GOOGLE_CLIENT_ID: envField.string({ context: "server", access: "secret" }),
      GOOGLE_CLIENT_SECRET: envField.string({ context: "server", access: "secret" }),
      GOOGLE_REDIRECT_URI: envField.string({ context: "server", access: "secret" }),
      DATA_CONTROLLER_NAME: envField.string({ context: "server", access: "secret" }),
      DATA_CONTROLLER_EMAIL: envField.string({ context: "server", access: "secret" }),
      BOOTSTRAP_ADMIN_EMAIL: envField.string({ context: "server", access: "secret", optional: true }),
    },
  },
});
