import { sql, type SQL, type SQLWrapper } from "drizzle-orm";
import type { Client } from "@src/db/client";
import type { Filter, TableName } from "@src/db/filters";

interface RowsQuery {
	findMany(config: { columns: {}; extras: { row: SQLWrapper }; where: unknown }): SQLWrapper;
}

function rows<Table extends TableName>(client: Client, table: Table, where: Filter<Table>) {
	return (client.query[table] as RowsQuery).findMany({ columns: {}, extras: { row: sql`1` }, where });
}

// Embedded in the extras of a relational query, a filter cannot refer to the outer query's columns:
// both queries use the same table aliases.

export function countRows<Table extends TableName>(client: Client, table: Table, where: Filter<Table>) {
	return client.$count(sql`(${rows(client, table, where)})`);
}

// A count of the table for each filter, ready for `selectCounts`.
export function countsOf<Table extends TableName, Key extends string>(client: Client, table: Table, filters: Record<Key, Filter<Table>>) {
	const counts = {} as Record<Key, SQLWrapper>;
	for (const key in filters) counts[key] = sql<number>`${countRows(client, table, filters[key])}`;
	return counts;
}

// Reads several counts with one statement. Each count is built from a relational filter, so it counts
// exactly the rows that a list with the same filter shows.
export async function selectCounts<Key extends string>(client: Client, counts: Record<Key, SQLWrapper>): Promise<Record<Key, number>> {
	const columns = Object.entries<SQLWrapper>(counts).map(([key, count]) => sql`${count} as ${sql.identifier(key)}`);
	const row = await client.get<Record<Key, number>>(sql`select ${sql.join(columns, sql`, `)}`);
	if (!row) throw new Error("A select without a table returns one row.");
	return row;
}

export function hasRows<Table extends TableName>(client: Client, table: Table, where: Filter<Table>) {
	return sql`exists ${rows(client, table, where)}`.mapWith(Boolean);
}

export function asBoolean(condition: SQL) {
	return sql<boolean>`${condition}`.mapWith(Boolean);
}
