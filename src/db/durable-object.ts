import { drizzle } from "drizzle-orm/durable-sqlite";
import { migrate } from "drizzle-orm/durable-sqlite/migrator";
import bundle from "../../.drizzle/migrations.js";
import { createDatabase, type Database } from "@src/db";
import { relations } from "@src/db/relations";
import { meterRows, type RowCounts, type RowMeter } from "@src/db/row-meter";
import type { PictureStore } from "@src/pictures/store";

// Hears of each call of a method of the database, such as `reviews.listEveryone`, with the rows it read and wrote.
export type CallReport = (call: string, rows: RowCounts) => void;

function isMethodArea(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null;
}

// The database, with each method of each area counting the rows it reads and writes. onWork is not a call.
function meterCalls(db: Database, meter: RowMeter, report: CallReport): Database {
	const metered = Object.entries(db).map(([area, methods]) => {
		if (!isMethodArea(methods)) return [area, methods];
		const meteredMethods = Object.entries(methods).map(([method, fn]) => {
			if (typeof fn !== "function") return [method, fn];
			const call = `${area}.${method}`;
			return [method, (...args: unknown[]) => meter.measure(async () => fn(...args), (rows) => report(call, rows))];
		});
		return [area, Object.fromEntries(meteredMethods)];
	});
	return Object.fromEntries(metered) as Database;
}

// The database in the SQLite storage of the Durable Object. Brings the tables up to date before it is used.
export function openDurableDatabase(storage: DurableObjectStorage, pictures: PictureStore, report: CallReport) {
	const meter = meterRows(storage);
	const client = drizzle(meter.storage, { relations });
	migrate(client, bundle);
	return meterCalls(createDatabase(client, pictures), meter, report);
}
