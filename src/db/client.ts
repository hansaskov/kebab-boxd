import type { SQLiteAsyncDatabase } from "drizzle-orm/sqlite-core";
import type { relations } from "@src/db/relations";

export type Client = SQLiteAsyncDatabase<"sync", unknown, typeof relations>;
export type Transaction = Parameters<Parameters<Client["transaction"]>[0]>[0];
