import type { SQLiteAsyncDatabase } from "drizzle-orm/sqlite-core";
import type { relations } from "@src/db/relations";

// Any synchronous SQLite driver: the storage of the Durable Object in production, node:sqlite in the tests.
export type Client = SQLiteAsyncDatabase<"sync", unknown, typeof relations>;
export type Transaction = Parameters<Parameters<Client["transaction"]>[0]>[0];
