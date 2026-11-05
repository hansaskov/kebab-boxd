// The limits of SQLite in a Durable Object, which are lower than those of SQLite itself. The tests set the same
// limits on their database, so a statement that is too large fails there first.
export const durableSqliteLimits = {
	// Values bound to one statement.
	variableNumber: 100,
	// Bytes of SQL in one statement.
	sqlLength: 100_000,
} as const;

export function chunks<T>(items: readonly T[], size: number): T[][] {
	return Array.from({ length: Math.ceil(items.length / size) }, (_, index) => items.slice(index * size, (index + 1) * size));
}
