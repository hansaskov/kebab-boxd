import { sql, type AnyColumn, type SQL } from "drizzle-orm";
import type { SQLiteTable } from "drizzle-orm/sqlite-core";
import type { Client } from "@src/db/client";

export const fewMatchesLimit = 500;

const shortestTextFound = 3;

type TableWithId = SQLiteTable & { id: AnyColumn };

export interface TextIndex<Table extends TableWithId> {
	table: Table;
	searchTable: string;
	searchedColumns: readonly string[];
	startsWith: (table: Table, prefix: string) => SQL;
}

export interface TextMatch<Table extends TableWithId> {
	matches: (table: Table) => SQL;
	fewIds: number[] | undefined;
}

function isShort(text: string) {
	return [...text].length < shortestTextFound;
}

function quotedPhrase(text: string) {
	return `"${text.replaceAll('"', '""')}"`;
}

function textQuery(text: string, columns: readonly string[]) {
	return `{${columns.join(" ")}}: ${quotedPhrase(text)}`;
}

function afterPrefix(prefix: string) {
	const characters = [...prefix];
	const last = characters.pop() ?? "";
	return characters.join("") + String.fromCodePoint((last.codePointAt(0) ?? 0) + 1);
}

export function unindexed(column: AnyColumn) {
	return sql`+${column}`;
}

export function startsWith(column: AnyColumn | SQL, prefix: string) {
	return sql`(${column} >= ${prefix} and ${column} < ${afterPrefix(prefix)})`;
}

export function startsWithIgnoringCase(column: AnyColumn, prefix: string) {
	return startsWith(sql`${column} collate nocase`, prefix);
}

function matchingIds<Table extends TableWithId>(index: TextIndex<Table>, text: string): SQL {
	if (isShort(text)) return sql`select ${index.table.id} as id from ${index.table} where ${index.startsWith(index.table, text)}`;
	const searchTable = sql.identifier(index.searchTable);
	return sql`select rowid as id from ${searchTable} where ${searchTable} match ${textQuery(text, index.searchedColumns)}`;
}

function isAmong(id: AnyColumn, ids: number[]) {
	if (ids.length === 0) return sql`false`;
	return sql`${id} in (${sql.raw(ids.map((one) => String(Math.trunc(one))).join(", "))})`;
}

function matchesRow<Table extends TableWithId>(index: TextIndex<Table>, text: string, table: Table): SQL {
	if (isShort(text)) return index.startsWith(table, text);
	const searchTable = sql.identifier(index.searchTable);
	return sql`exists (select 1 from ${searchTable} where ${searchTable} match ${textQuery(text, index.searchedColumns)} and rowid = ${table.id})`;
}

export function matchText<Table extends TableWithId>(client: Client, index: TextIndex<Table>, text: string): TextMatch<Table> {
	const ids = client.all<{ id: number }>(sql`${matchingIds(index, text)} limit ${fewMatchesLimit + 1}`).map((row) => row.id);
	if (ids.length > fewMatchesLimit) return { matches: (table) => matchesRow(index, text, table), fewIds: undefined };
	return { matches: (table) => isAmong(table.id, ids), fewIds: ids };
}
