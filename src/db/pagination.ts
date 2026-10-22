import { asc, desc, getColumns, gt, lt, sql, type GetColumnData, type Placeholder, type SQL } from "drizzle-orm";
import type { SQLiteTable } from "drizzle-orm/sqlite-core";
import type { Page, PageRequest } from "@src/pagination";

export interface Seek {
	where: SQL | undefined;
	orderBy: SQL;
	limit: Placeholder;
}

type Direction = "first" | "after" | "before";

interface PreparedList<Row> {
	all(values: Record<string, unknown>): Row[] | Promise<Row[]>;
}

export function cursorList<
	Table extends SQLiteTable,
	Key extends keyof Table["_"]["columns"] & string,
	Row extends Record<Key, GetColumnData<Table["_"]["columns"][Key]>>,
>(table: Table, key: Key, order: "asc" | "desc", prepare: (seek: Seek) => PreparedList<Row>) {
	const column = getColumns(table)[key];
	if (!column) throw new Error(`The table has no column ${key}.`);
	const sqlType = column.getSQLType();
	const isInteger = sqlType === "integer";
	if (!isInteger && !sqlType.startsWith("text")) {
		throw new Error(`A cursor list cannot be ordered by the ${sqlType} column ${column.name}.`);
	}

	const decode = (cursor: string) => {
		if (!isInteger) return cursor;
		const value = Number(cursor);
		return Number.isSafeInteger(value) ? value : undefined;
	};
	const keyOf = (row: Row): unknown => column.mapToDriverValue(row[key]);

	const placeholder = { cursor: sql.placeholder("pageCursor"), limit: sql.placeholder("pageLimit") };
	const ascending = order === "asc";
	const forward = ascending ? asc(column) : desc(column);
	const following = ascending ? gt(column, placeholder.cursor) : lt(column, placeholder.cursor);
	const preceding = ascending ? lt(column, placeholder.cursor) : gt(column, placeholder.cursor);
	const queries: Record<Direction, PreparedList<Row>> = {
		first: prepare({ where: undefined, orderBy: forward, limit: placeholder.limit }),
		after: prepare({ where: following, orderBy: forward, limit: placeholder.limit }),
		before: prepare({ where: preceding, orderBy: ascending ? desc(column) : asc(column), limit: placeholder.limit }),
	};

	return async function readPage({ limit, cursor }: PageRequest, values: Record<string, unknown> = {}): Promise<Page<Row>> {
		const read = async (direction: Direction, rows: number, at?: unknown) =>
			queries[direction].all({ ...values, pageLimit: rows, pageCursor: at });
		const hasRows = async (direction: "after" | "before", at: unknown) => (await read(direction, 1, at)).length > 0;

		const toPage = (items: Row[], hasPrevious: boolean, hasNext: boolean): Page<Row> => {
			const first = items.at(0);
			const last = items.at(-1);
			return {
				items,
				previous: hasPrevious && first !== undefined ? { before: String(keyOf(first)) } : undefined,
				next: hasNext && last !== undefined ? { after: String(keyOf(last)) } : undefined,
				isPastEnd: false,
			};
		};

		const readFirst = async () => {
			const rows = await read("first", limit + 1);
			return toPage(rows.slice(0, limit), false, rows.length > limit);
		};

		const after = cursor && "after" in cursor ? decode(cursor.after) : undefined;
		if (after !== undefined) {
			const rows = await read("after", limit + 1, after);
			const items = rows.slice(0, limit);
			const first = items.at(0);
			if (first === undefined) {
				const hasPrevious = await hasRows("before", after);
				return { items, previous: hasPrevious ? { before: String(after) } : undefined, next: undefined, isPastEnd: true };
			}
			return toPage(items, await hasRows("before", keyOf(first)), rows.length > limit);
		}

		const before = cursor && "before" in cursor ? decode(cursor.before) : undefined;
		if (before !== undefined) {
			const rows = await read("before", limit + 1, before);
			if (rows.length <= limit) return readFirst();
			const items = rows.slice(0, limit).toReversed();
			const last = items.at(-1);
			return toPage(items, true, last !== undefined && (await hasRows("after", keyOf(last))));
		}

		return readFirst();
	};
}
