import { sql, type SQLWrapper } from "drizzle-orm";
import type { Client } from "@src/db/client";
import type { Filter, TableName } from "@src/db/filters";

interface CountableQuery {
	findMany(config: { columns: {}; extras: { row: SQLWrapper }; where: unknown }): SQLWrapper;
}

export async function countRows<Table extends TableName>(client: Client, table: Table, where: Filter<Table>) {
	const rows = (client.query[table] as CountableQuery).findMany({ columns: {}, extras: { row: sql`1` }, where });
	return client.$count(sql`(${rows})`);
}
