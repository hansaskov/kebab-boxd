import { defineConfig, envField } from "astro/config";
import tailwindcss from "@tailwindcss/vite";

import node from "@astrojs/node";

// https://astro.build/config
export default defineConfig({
  site: "https://hans.askov.dk",
  output: "static",

  build: {
    inlineStylesheets: "always",
  },
  env: {
    schema: {
      DB_FILE_NAME: envField.string({ access: "secret", context: "server", optional: false }),
    },
    validateSecrets: true,
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
