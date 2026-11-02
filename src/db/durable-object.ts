import { drizzle } from "drizzle-orm/durable-sqlite";
import { migrate } from "drizzle-orm/durable-sqlite/migrator";
import bundle from "../../.drizzle/migrations.js";
import { createDatabase } from "@src/db";
import { relations } from "@src/db/relations";
import type { PictureStore } from "@src/pictures/store";

// The database in the SQLite storage of the Durable Object. Brings the tables up to date before it is used.
export function openDurableDatabase(storage: DurableObjectStorage, pictures: PictureStore) {
	const client = drizzle(storage, { relations });
	migrate(client, bundle);
	return createDatabase(client, pictures);
}
