import { drizzle } from "drizzle-orm/node-sqlite";
import { migrate } from "drizzle-orm/node-sqlite/migrator";
import { relations } from "@src/db/relations";

const MIGRATIONS_DIR = ".drizzle";

export function createClient(dbFileName: string) {
	return drizzle(dbFileName, { relations, jit: true });
}

export function migrateClient(client: Client) {
	return migrate(client, {
		migrationsFolder: MIGRATIONS_DIR,
	});
}

export type Client = ReturnType<typeof createClient>;
