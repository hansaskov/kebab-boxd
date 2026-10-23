import { asc, desc, getColumns, sql, type Column, type GetColumnData, type Placeholder, type SQL } from "drizzle-orm";
import type { SQLiteTable } from "drizzle-orm/sqlite-core";
import type { Page, PageRequest } from "@src/pagination";

export interface Seek {
	where: SQL | undefined;
	orderBy: SQL[];
	limit: Placeholder;
}

type Direction = "first" | "after" | "before";

type ColumnName<Table extends SQLiteTable> = keyof Table["_"]["columns"] & string;

type KeyValues<Table extends SQLiteTable, Keys extends readonly ColumnName<Table>[]> = {
	[Key in Keys[number]]: GetColumnData<Table["_"]["columns"][Key]>;
};

interface PreparedList<Row> {
	all(values: Record<string, unknown>): Row[] | Promise<Row[]>;
}

const compositeSeparator = ".";

function isIntegerColumn(column: Column) {
	return column.getSQLType() === "integer";
}

function encode(values: unknown[]) {
	return values.map(String).join(compositeSeparator);
}

function parseSafeInteger(text: string) {
	if (!/^-?\d+$/.test(text)) return undefined;
	const value = Number(text);
	return Number.isSafeInteger(value) ? value : undefined;
}

export function cursorList<
	Table extends SQLiteTable,
	const Keys extends readonly [ColumnName<Table>, ...ColumnName<Table>[]],
	Row extends KeyValues<Table, Keys>,
>(table: Table, keys: Keys, order: "asc" | "desc", prepare: (seek: Seek) => PreparedList<Row>) {
	const tableColumns = getColumns(table);
	const columns = keys.map((key) => {
		const column = tableColumns[key];
		if (!column) throw new Error(`The table has no column ${key}.`);
		const sqlType = column.getSQLType();
		if (!isIntegerColumn(column) && !sqlType.startsWith("text")) {
			throw new Error(`A cursor list cannot be ordered by the ${sqlType} column ${column.name}.`);
		}
		return column;
	});
	const isComposite = columns.length > 1;
	if (isComposite && !columns.every(isIntegerColumn)) {
		throw new Error("A cursor list ordered by several columns can only use integer columns.");
	}

	const decode = (cursor: string): unknown[] | undefined => {
		const parts = isComposite ? cursor.split(compositeSeparator) : [cursor];
		if (parts.length !== columns.length) return undefined;
		const values = parts.map((part, i) => (isIntegerColumn(columns[i]!) ? parseSafeInteger(part) : part));
		return values.includes(undefined) ? undefined : values;
	};
	const keyOf = (row: Row): unknown[] => columns.map((column, i) => column.mapToDriverValue(row[keys[i]!]));

	const limitPlaceholder = sql.placeholder("pageLimit");
	const cursorPlaceholders = columns.map((_, i) => sql.placeholder(`pageCursor${i}`));
	const compare = (operator: "<" | ">") =>
		sql`(${sql.join(columns, sql`, `)}) ${sql.raw(operator)} (${sql.join(cursorPlaceholders, sql`, `)})`;
	const orderBy = (ascending: boolean) => columns.map((column) => (ascending ? asc(column) : desc(column)));

	const ascending = order === "asc";
	const queries: Record<Direction, PreparedList<Row>> = {
		first: prepare({ where: undefined, orderBy: orderBy(ascending), limit: limitPlaceholder }),
		after: prepare({ where: compare(ascending ? ">" : "<"), orderBy: orderBy(ascending), limit: limitPlaceholder }),
		before: prepare({ where: compare(ascending ? "<" : ">"), orderBy: orderBy(!ascending), limit: limitPlaceholder }),
	};

	return async function readPage({ limit, cursor }: PageRequest, values: Record<string, unknown> = {}): Promise<Page<Row>> {
		const read = async (direction: Direction, rows: number, at: unknown[] = []) =>
			queries[direction].all({
				...values,
				pageLimit: rows,
				...Object.fromEntries(at.map((value, i) => [`pageCursor${i}`, value])),
			});
		const hasRows = async (direction: "after" | "before", at: unknown[]) => (await read(direction, 1, at)).length > 0;

		const toPage = (items: Row[], hasPrevious: boolean, hasNext: boolean): Page<Row> => {
			const first = items.at(0);
			const last = items.at(-1);
			return {
				items,
				previous: hasPrevious && first !== undefined ? { before: encode(keyOf(first)) } : undefined,
				next: hasNext && last !== undefined ? { after: encode(keyOf(last)) } : undefined,
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
				return { items, previous: hasPrevious ? { before: encode(after) } : undefined, next: undefined, isPastEnd: true };
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
