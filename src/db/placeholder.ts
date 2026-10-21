import { sql } from "drizzle-orm";
import type { DriverValueEncoder } from "drizzle-orm";

export function encodedPlaceholder<TData, TDriver>(
	name: string,
	column: DriverValueEncoder<TData, TDriver>,
) {
	return sql.param(sql.placeholder(name), column);
}
