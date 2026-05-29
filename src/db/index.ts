import { drizzle } from "drizzle-orm/node-sqlite";
import { relations } from "./relations";
import { DB_FILE_NAME } from "astro:env/server";

export const db = drizzle(DB_FILE_NAME, { relations, jit: true });
