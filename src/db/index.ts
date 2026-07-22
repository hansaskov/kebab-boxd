import { drizzle } from "drizzle-orm/node-sqlite";
import { migrate } from "drizzle-orm/node-sqlite/migrator";
import { relations } from "./relations";
export * as s from "./schema";

const MIGRATIONS_DIR = ".drizzle";

export function createDatabase(dbFileName: string) {
	return drizzle(dbFileName, { relations, jit: true });
}

export function migrateDatabase(db: DB) {
	return migrate(db, {
		migrationsFolder: MIGRATIONS_DIR
	})
}

export type DB = ReturnType<typeof createDatabase>;