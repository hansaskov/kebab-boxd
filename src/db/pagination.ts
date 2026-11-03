import { asc, desc, getColumns, sql, type Column, type GetColumnData, type RelationsFilter, type SQL } from "drizzle-orm";
import type { SQLiteTable } from "drizzle-orm/sqlite-core";
import { relations } from "@src/db/relations";
import type { Page, PageRequest } from "@src/pagination";

type Tables = typeof relations;

export type TableName = keyof Tables;
export type Filter<Table extends TableName> = RelationsFilter<Tables[Table], Tables>;

type SchemaTable<Name extends TableName> = (typeof relations)[Name]["table"];

// Narrows the filter of a relational query to one page and orders it: `findMany({ ...columns, ...seek(where) })`.
export type Seek<Name extends TableName> = (where: Filter<Name>) => {
	where: Filter<Name>;
	orderBy: (table: SchemaTable<Name>) => SQL[];
	limit: number;
};

type Direction = "first" | "after" | "before";

type ColumnName<Table extends SQLiteTable> = keyof Table["_"]["columns"] & string;

// A key the query computes, such as a count. Its value is an integer, and each row carries it as an extra of the same name.
export interface ComputedKey<Table extends SQLiteTable> {
	name: string;
	value: (table: Table) => SQL;
}

type Key<Table extends SQLiteTable> = ColumnName<Table> | ComputedKey<Table>;

type KeyValues<Table extends SQLiteTable, Keys extends readonly Key<Table>[]> = {
	[Name in Extract<Keys[number], string>]: GetColumnData<Table["_"]["columns"][Name]>;
} & {
	[Computed in Extract<Keys[number], ComputedKey<Table>> as Computed["name"]]: number;
};

// Decimal points and minus signs can appear in the values, so the separator must be neither.
const compositeSeparator = "_";

function isIntegerColumn(column: Column) {
	return column.getSQLType() === "integer";
}

function isRealColumn(column: Column) {
	return column.getSQLType() === "real";
}

function isNumberColumn(column: Column) {
	return isIntegerColumn(column) || isRealColumn(column);
}

function encode(values: unknown[]) {
	return values.map(String).join(compositeSeparator);
}

function parseSafeInteger(text: string) {
	if (!/^-?\d+$/.test(text)) return undefined;
	const value = Number(text);
	return Number.isSafeInteger(value) ? value : undefined;
}

function parseFiniteNumber(text: string) {
	if (!/^-?\d+(\.\d+)?(e[+-]?\d+)?$/.test(text)) return undefined;
	const value = Number(text);
	return Number.isFinite(value) ? value : undefined;
}

function parserFor(column: Column): (text: string) => unknown {
	if (isIntegerColumn(column)) return parseSafeInteger;
	if (isRealColumn(column)) return parseFiniteNumber;
	return (text) => text;
}

export function cursorList<
	Name extends TableName,
	const Keys extends readonly [Key<SchemaTable<Name>>, ...Key<SchemaTable<Name>>[]],
>(name: Name, keys: Keys, order: "asc" | "desc") {
	type Table = SchemaTable<Name>;
	// The generic table type is too deep to check column by column, so the columns are read as plain columns.
	const columnsOf = (table: Table) => getColumns(table as SQLiteTable) as Record<string, Column>;
	const tableColumns = columnsOf(relations[name].table as Table);
	const columns = keys.map((key) => {
		if (typeof key !== "string") return undefined;
		const column = tableColumns[key];
		if (!column) throw new Error(`The table has no column ${key}.`);
		const sqlType = column.getSQLType();
		if (!isNumberColumn(column) && !sqlType.startsWith("text")) {
			throw new Error(`A cursor list cannot be ordered by the ${sqlType} column ${column.name}.`);
		}
		return column;
	});
	const isComposite = columns.length > 1;
	if (isComposite && !columns.every((column) => column === undefined || isNumberColumn(column))) {
		throw new Error("A cursor list ordered by several columns can only use number columns.");
	}
	const parsers = columns.map((column) => (column ? parserFor(column) : parseSafeInteger));
	const nameOf = (key: Keys[number]) => (typeof key === "string" ? key : key.name);

	const decode = (cursor: string): unknown[] | undefined => {
		const parts = isComposite ? cursor.split(compositeSeparator) : [cursor];
		if (parts.length !== columns.length) return undefined;
		const values = parts.map((part, i) => parsers[i]!(part));
		return values.includes(undefined) ? undefined : values;
	};
	const keyOf = (row: KeyValues<Table, Keys>): unknown[] =>
		keys.map((key, i) => {
			const value = (row as Record<string, unknown>)[nameOf(key)];
			return columns[i] ? columns[i].mapToDriverValue(value) : value;
		});

	const keyColumns = (aliased: Table) => keys.map((key) => (typeof key === "string" ? columnsOf(aliased)[key]! : key.value(aliased)));
	const compare = (operator: "<" | ">" | "<=" | ">=", at: unknown[]) => ({
		RAW: (aliased: Table) =>
			sql`(${sql.join(keyColumns(aliased), sql`, `)}) ${sql.raw(operator)} (${sql.join(
				at.map((value) => sql`${value}`),
				sql`, `,
			)})`,
	});
	const orderBy = (ascending: boolean) => (aliased: Table) =>
		keyColumns(aliased).map((column) => (ascending ? asc(column) : desc(column)));

	const ascending = order === "asc";
	const seek = (direction: Direction, limit: number, at: unknown[], inclusive: boolean): Seek<Name> => {
		const forward = direction === "after" ? ascending : !ascending;
		const operator = `${forward ? ">" : "<"}${inclusive ? "=" : ""}` as const;
		const page = direction === "first" ? { where: {}, orderBy: orderBy(ascending) } : { where: compare(operator, at), orderBy: orderBy(forward) };
		return (where) => ({ where: { AND: [where, page.where] } as Filter<Name>, orderBy: page.orderBy, limit });
	};

	return async function readPage<Row extends KeyValues<Table, Keys>>(
		{ limit, cursor }: PageRequest,
		query: (seek: Seek<Name>) => PromiseLike<Row[]>,
	): Promise<Page<Row>> {
		const read = async (direction: Direction, rows: number, at: unknown[] = [], inclusive = false) =>
			query(seek(direction, rows, at, inclusive));
		const hasRows = async (direction: "after" | "before", at: unknown[]) => (await read(direction, 1, at)).length > 0;

		// Reads the rows from the cursor on, including the row at the cursor. When that row still exists,
		// it proves that there are rows behind the cursor, so no second query is needed to find out.
		const readFrom = async (direction: "after" | "before", at: unknown[], count: number) => {
			const rows = await read(direction, count + 1, at, true);
			const first = rows.at(0);
			const isAtCursor = first !== undefined && encode(keyOf(first)) === encode(at);
			return {
				rows: isAtCursor ? rows.slice(1) : rows.slice(0, count),
				hasRowsBehind: async () => isAtCursor || hasRows(oppositeOf(direction), at),
			};
		};

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
			const { rows, hasRowsBehind } = await readFrom("after", after, limit + 1);
			const items = rows.slice(0, limit);
			if (items.length === 0) {
				return { items, previous: (await hasRowsBehind()) ? { before: encode(after) } : undefined, next: undefined, isPastEnd: true };
			}
			return toPage(items, await hasRowsBehind(), rows.length > limit);
		}

		const before = cursor && "before" in cursor ? decode(cursor.before) : undefined;
		if (before !== undefined) {
			const { rows, hasRowsBehind } = await readFrom("before", before, limit + 1);
			if (rows.length < limit) return readFirst();
			return toPage(rows.slice(0, limit).toReversed(), rows.length > limit, await hasRowsBehind());
		}

		return readFirst();
	};
}

function oppositeOf(direction: "after" | "before") {
	return direction === "after" ? "before" : "after";
}
