import { DurableObject } from "cloudflare:workers";
import { drizzle } from "drizzle-orm/durable-sqlite";
import type { Database } from "@src/db";
import { openDurableDatabase } from "@src/db/durable-object";
import { relations } from "@src/db/relations";
import { callDatabase } from "@src/db/remote";
import { meterRows, withExec, type RowCounts } from "@src/db/row-meter";
import { createPictureStore } from "@src/pictures/store";
import { fromJson, toJson } from "@src/tests/json";
import { fillLargeDatabase } from "@src/tests/large-database";

interface Env {
	Pictures: R2Bucket;
	Images: ImagesBinding;
}

interface Statement {
	query: string;
	bindings: unknown[];
}

// A statement with how SQLite runs it, one line for each step of EXPLAIN QUERY PLAN, indented under its parent.
export interface PlannedStatement {
	query: string;
	plan: string[];
}

interface PlanRow {
	id: number;
	parent: number;
	detail: string;
}

function planLines(rows: PlanRow[]): string[] {
	const depth = new Map<number, number>([[0, -1]]);
	return rows.map(({ id, parent, detail }) => {
		const level = (depth.get(parent) ?? -1) + 1;
		depth.set(id, level);
		return `${"  ".repeat(level)}${detail}`;
	});
}

// The storage, keeping each statement the database runs.
function recordingStatements(storage: DurableObjectStorage, statements: Statement[]): DurableObjectStorage {
	return withExec(storage, (query, ...bindings) => {
		statements.push({ query, bindings });
		return storage.sql.exec(query, ...bindings);
	});
}

// The database in a Durable Object, as in production, with the rows of each call counted the way Cloudflare
// counts them, and the plan of each statement. The tests in Node reach it through Miniflare, which passes text, so
// values travel as JSON.
export class MeasuredDatabase extends DurableObject<Env> {
	readonly #db: Database;
	readonly #storage: DurableObjectStorage;
	readonly #statements: Statement[] = [];
	#rows: RowCounts[] = [];

	constructor(ctx: DurableObjectState, env: Env) {
		super(ctx, env);
		this.#storage = ctx.storage;
		const storage = recordingStatements(ctx.storage, this.#statements);
		this.#db = openDurableDatabase(storage, createPictureStore(env.Pictures, env.Images), (_call, rows) => this.#rows.push(rows));
	}

	async fill(scale: number): Promise<string> {
		return toJson(await fillLargeDatabase(drizzle(this.#storage, { relations }), scale));
	}

	// Runs one method of the database, and tells what it returned, the rows it read and wrote, and the plan of
	// each statement it ran.
	async measure(area: string, method: string, args: string): Promise<string> {
		this.#rows = [];
		this.#statements.length = 0;
		const value = await callDatabase(this.#db, area, method, fromJson(args) as unknown[]);
		const [rows, ...others] = this.#rows;
		if (!rows || others.length > 0) throw new Error(`Expected one call of the database, not ${this.#rows.length}.`);
		const statements: PlannedStatement[] = this.#statements.map(({ query, bindings }) => ({
			query,
			plan: planLines(this.#storage.sql.exec<Record<string, SqlStorageValue>>(`EXPLAIN QUERY PLAN ${query}`, ...bindings).toArray() as unknown as PlanRow[]),
		}));
		return toJson({ value, rows, statements });
	}

	// Counts two pieces of work that run at once: each reads a table, waits for R2, which lets the other run, and
	// reads its table again. Tells the rows each read.
	async meterOverlappingWork(): Promise<string> {
		const meter = meterRows(this.#storage);
		const rows: Record<string, RowCounts> = {};
		const readTwice = (table: "users" | "restaurants") =>
			meter.measure(
				async () => {
					meter.storage.sql.exec(`SELECT * FROM ${table}`).toArray();
					await this.env.Pictures.head("nothing");
					meter.storage.sql.exec(`SELECT * FROM ${table}`).toArray();
				},
				(counted) => (rows[table] = counted),
			);
		await Promise.all([readTwice("users"), readTwice("restaurants")]);
		const count = (table: string) => this.#storage.sql.exec<{ count: number }>(`SELECT count(*) AS count FROM ${table}`).one().count;
		return toJson({ rows, users: count("users"), restaurants: count("restaurants") });
	}
}

export default {
	fetch: () => new Response(null, { status: 404 }),
};
