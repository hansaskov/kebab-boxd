import { defineConfig, envField, memoryCache} from "astro/config";
import tailwindcss from "@tailwindcss/vite";

import node from "@astrojs/node";

export default defineConfig({
  site: "https://hans.askov.dk",
  output: "server",
  build: {
    inlineStylesheets: "always",
  },
  vite: {
    plugins: [tailwindcss()],
  },
  cache: {
    provider: memoryCache(),
  },
  session: false,
  security: {
    // Room for the four pictures a review can have, at most 10 MB each.
    actionBodySizeLimit: 41 * 1024 * 1024,
  },
  adapter: node({
    mode: "standalone",
  }),
  env: {
    schema: {
      DB_FILE_NAME: envField.string({ context: "server", access: "secret" }),
      PICTURES_DIR: envField.string({ context: "server", access: "secret", default: "pictures" }),
      GOOGLE_CLIENT_ID: envField.string({ context: "server", access: "secret" }),
      GOOGLE_CLIENT_SECRET: envField.string({ context: "server", access: "secret" }),
      GOOGLE_REDIRECT_URI: envField.string({ context: "server", access: "secret" }),
      DATA_CONTROLLER_NAME: envField.string({ context: "server", access: "secret" }),
      DATA_CONTROLLER_EMAIL: envField.string({ context: "server", access: "secret" }),
    },
  },
  image: {
    service: {
      config: {
        webp: { effort: import.meta.env.PROD ? 6 : 0 },
        avif: { effort: import.meta.env.PROD ? 9 : 0 },
      },
    },
  },
});
