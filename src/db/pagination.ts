import { asc, desc, getColumns, sql, type Column, type GetColumnData, type SQL } from "drizzle-orm";
import type { SQLiteTable } from "drizzle-orm/sqlite-core";
import type { Page, PageRequest } from "@src/pagination";

export interface Seek<Table extends SQLiteTable> {
	where: { RAW?: (table: Table) => SQL };
	orderBy: (table: Table) => SQL[];
	limit: number;
}

type Direction = "first" | "after" | "before";

type ColumnName<Table extends SQLiteTable> = keyof Table["_"]["columns"] & string;

type KeyValues<Table extends SQLiteTable, Keys extends readonly ColumnName<Table>[]> = {
	[Key in Keys[number]]: GetColumnData<Table["_"]["columns"][Key]>;
};

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
>(table: Table, keys: Keys, order: "asc" | "desc") {
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
	const keyOf = (row: KeyValues<Table, Keys>): unknown[] =>
		columns.map((column, i) => column.mapToDriverValue(row[keys[i]!]));

	const keyColumns = (aliased: Table) => keys.map((key) => getColumns(aliased)[key]!);
	const compare = (operator: "<" | ">", at: unknown[]) => ({
		RAW: (aliased: Table) =>
			sql`(${sql.join(keyColumns(aliased), sql`, `)}) ${sql.raw(operator)} (${sql.join(
				at.map((value) => sql`${value}`),
				sql`, `,
			)})`,
	});
	const orderBy = (ascending: boolean) => (aliased: Table) =>
		keyColumns(aliased).map((column) => (ascending ? asc(column) : desc(column)));

	const ascending = order === "asc";
	const seek = (direction: Direction, limit: number, at: unknown[]): Seek<Table> => {
		switch (direction) {
			case "first":
				return { where: {}, orderBy: orderBy(ascending), limit };
			case "after":
				return { where: compare(ascending ? ">" : "<", at), orderBy: orderBy(ascending), limit };
			case "before":
				return { where: compare(ascending ? "<" : ">", at), orderBy: orderBy(!ascending), limit };
		}
	};

	return async function readPage<Row extends KeyValues<Table, Keys>>(
		{ limit, cursor }: PageRequest,
		query: (seek: Seek<Table>) => PromiseLike<Row[]>,
	): Promise<Page<Row>> {
		const read = async (direction: Direction, rows: number, at: unknown[] = []) => query(seek(direction, rows, at));
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
