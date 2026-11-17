import { AsyncLocalStorage } from "node:async_hooks";

export interface RowCounts {
	rowsRead: number;
	rowsWritten: number;
}

type Cursor = Pick<SqlStorageCursor<Record<string, SqlStorageValue>>, "rowsRead" | "rowsWritten">;

function boundTo<Target extends object>(target: Target, key: string | symbol) {
	const value: unknown = Reflect.get(target, key, target);
	return typeof value === "function" ? value.bind(target) : value;
}

export function withExec(storage: DurableObjectStorage, exec: SqlStorage["exec"]): DurableObjectStorage {
	const sql = new Proxy(storage.sql, { get: (target, key) => (key === "exec" ? exec : boundTo(target, key)) });
	return new Proxy(storage, { get: (target, key) => (key === "sql" ? sql : boundTo(target, key)) });
}

export function meterRows(storage: DurableObjectStorage) {
	const cursorsOfWork = new AsyncLocalStorage<Cursor[]>();

	const exec: SqlStorage["exec"] = <Row extends Record<string, SqlStorageValue>>(query: string, ...bindings: unknown[]) => {
		const cursor = storage.sql.exec<Row>(query, ...bindings);
		cursorsOfWork.getStore()?.push(cursor);
		return cursor;
	};

	return {
		storage: withExec(storage, exec),

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
