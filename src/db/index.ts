import { drizzle } from "drizzle-orm/node-sqlite";
import { relations } from "./relations";

export const db = drizzle(process.env.DB_FILE_NAME!, { relations, jit: true });
