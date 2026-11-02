import { defineConfig } from "drizzle-kit";

export default defineConfig({
  out: "./.drizzle",
  schema: "./src/db/schema.ts",
  dialect: "sqlite",
  // Also writes migrations.js, which bundles the migrations into the Backend Worker.
  driver: "durable-sqlite",
});
