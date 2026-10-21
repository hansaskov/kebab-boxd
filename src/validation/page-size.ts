/** The number of rows a paged list may show, offered in its rows-per-page menu. */
export const pageSizes = [10, 25, 50, 100] as const;
export const defaultPageSize = 25;

/** Reads the `rows` query parameter. Sizes not on offer fall back to the default. */
export function parsePageSize(value: string | null): number {
	const rows = Number(value);
	return pageSizes.find((size) => size === rows) ?? defaultPageSize;
}
