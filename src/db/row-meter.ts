import { AsyncLocalStorage } from "node:async_hooks";

// The rows SQLite read and wrote for one piece of work. Cloudflare bills a Durable Object by them, and the free
// plan stops the database for the rest of the day when it has read 5 million.
export interface RowCounts {
	rowsRead: number;
	rowsWritten: number;
}

// What a cursor tells of the rows it has gone through.
type Cursor = Pick<SqlStorageCursor<Record<string, SqlStorageValue>>, "rowsRead" | "rowsWritten">;

// A method of a native object only works when it is called on that object, not on a proxy of it.
function boundTo<Target extends object>(target: Target, key: string | symbol) {
	const value: unknown = Reflect.get(target, key, target);
	return typeof value === "function" ? value.bind(target) : value;
}

// The storage, with every statement run by `exec` instead of by its own SQL.
export function withExec(storage: DurableObjectStorage, exec: SqlStorage["exec"]): DurableObjectStorage {
	const sql = new Proxy(storage.sql, { get: (target, key) => (key === "exec" ? exec : boundTo(target, key)) });
	return new Proxy(storage, { get: (target, key) => (key === "sql" ? sql : boundTo(target, key)) });
}

// Counts the rows each piece of work reads and writes in the SQLite storage of a Durable Object. The Durable Object
// runs another call while one waits, such as for R2, so the count follows each piece of work through its awaits
// instead of counting whatever ran in the meantime.
export function meterRows(storage: DurableObjectStorage) {
	const cursorsOfWork = new AsyncLocalStorage<Cursor[]>();

	const exec: SqlStorage["exec"] = <Row extends Record<string, SqlStorageValue>>(query: string, ...bindings: unknown[]) => {
		const cursor = storage.sql.exec<Row>(query, ...bindings);
		cursorsOfWork.getStore()?.push(cursor);
		return cursor;
	};

	return {
		// The storage to give the database, whose statements are counted.
		storage: withExec(storage, exec),

		// Runs the work and reports its rows, also when it fails. A cursor counts the rows it has gone through, so
		// they are added up once the work has read them all.
		async measure<Result>(work: () => Promise<Result>, report: (rows: RowCounts) => void): Promise<Result> {
			const cursors: Cursor[] = [];
			try {
				return await cursorsOfWork.run(cursors, work);
			} finally {
				report({
					rowsRead: cursors.reduce((sum, cursor) => sum + cursor.rowsRead, 0),
					rowsWritten: cursors.reduce((sum, cursor) => sum + cursor.rowsWritten, 0),
				});
			}
		},
	};
}

export type RowMeter = ReturnType<typeof meterRows>;
