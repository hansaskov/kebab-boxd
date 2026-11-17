export const durableSqliteLimits = {
	variableNumber: 100,
	sqlLength: 100_000,
} as const;

export function chunks<T>(items: readonly T[], size: number): T[][] {
	return Array.from({ length: Math.ceil(items.length / size) }, (_, index) => items.slice(index * size, (index + 1) * size));
}
