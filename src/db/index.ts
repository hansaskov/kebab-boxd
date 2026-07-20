import { drizzle } from "drizzle-orm/node-sqlite";
import { relations } from "./relations";
import * as s from "./schema";

const db = drizzle(process.env.DB_FILE_NAME!, { schema: s, relations, jit: true });

export { s, db };