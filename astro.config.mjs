import { defineConfig, envField } from "astro/config";
import tailwindcss from "@tailwindcss/vite";

import node from "@astrojs/node";

// https://astro.build/config
export default defineConfig({
  site: "https://hans.askov.dk",
  output: "server",
  env: {
    schema: {
      DB_FILE_NAME: envField.string({ context: "server", access: "secret" }),
      GOOGLE_CLIENT_ID: envField.string({ context: "server", access: "secret" }),
      GOOGLE_CLIENT_SECRET: envField.string({ context: "server", access: "secret" }),
      GOOGLE_REDIRECT_URI: envField.string({ context: "server", access: "secret" }),
    },
  },
  build: {
    inlineStylesheets: "always",
  },
  vite: {
    plugins: [tailwindcss()],
  },
  image: {
    service: {
      config: {
        webp: { effort: import.meta.env.PROD ? 6 : 0 }, // Run highest effort in prod
        avif: { effort: import.meta.env.PROD ? 9 : 0 }, // Run highest effort in prod
      },
    },
  },
  adapter: node({
    mode: "standalone",
  }),
});
