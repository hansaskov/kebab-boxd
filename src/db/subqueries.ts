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

export function hasRows<Table extends TableName>(client: Client, table: Table, where: Filter<Table>) {
	return sql`exists ${rows(client, table, where)}`.mapWith(Boolean);
}

export function asBoolean(condition: SQL) {
	return sql<boolean>`${condition}`.mapWith(Boolean);
}
