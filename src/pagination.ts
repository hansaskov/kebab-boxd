export const pageSizes = [10, 25, 50, 100] as const;
export const defaultPageSize = 10;

export type Cursor = { after: string } | { before: string };

export interface PageRequest {
	limit: number;
	cursor: Cursor | undefined;
}

export interface Page<T> {
	items: T[];
	previous: { before: string } | undefined;
	next: { after: string } | undefined;
	isPastEnd: boolean;
}

export type PageItem<List> = List extends Page<infer Row> ? Row : never;

export interface RowsChoice {
	rows: number;
	options: { rows: number; href: string }[];
}

export interface PageNavigation {
	previousHref: string | undefined;
	nextHref: string | undefined;
	rowsChoice: RowsChoice | undefined;
}

type QueryChanges = Record<string, string | undefined>;

function parseCursor(params: URLSearchParams): Cursor | undefined {
	const after = params.get("after");
	const before = params.get("before");
	if (after && !before) return { after };
	if (before && !after) return { before };
	return undefined;
}

function chosenRows(params: URLSearchParams): number {
	const rows = Number(params.get("rows"));
	return pageSizes.find((size) => size === rows) ?? defaultPageSize;
}

export function parsePageRequest(url: URL, fixedRows?: number): PageRequest {
	const params = url.searchParams;
	return { limit: fixedRows ?? chosenRows(params), cursor: parseCursor(params) };
}

export function pageNavigation(url: URL, { items, previous, next }: Page<unknown>, fixedRows?: number): PageNavigation | undefined {
	if (items.length === 0 && !previous) return undefined;

	const { limit, cursor } = parsePageRequest(url, fixedRows);
	const href = (to: Cursor | undefined, rows: number) =>
		hrefWith(url, {
			rows: fixedRows !== undefined || rows === defaultPageSize ? undefined : String(rows),
			after: to && "after" in to ? to.after : undefined,
			before: to && "before" in to ? to.before : undefined,
		});

	return {
		previousHref: previous && href(previous, limit),
		nextHref: next && href(next, limit),
		rowsChoice: fixedRows === undefined ? { rows: limit, options: pageSizes.map((rows) => ({ rows, href: href(cursor, rows) })) } : undefined,
	};
}

export function firstPageHref(url: URL, changes: QueryChanges): string {
	return hrefWith(url, { ...changes, after: undefined, before: undefined });
}

export function firstPageFields(url: URL, changes: QueryChanges): [name: string, value: string][] {
	return [...queryWith(url, { ...changes, after: undefined, before: undefined })];
}

function queryWith(url: URL, changes: QueryChanges) {
	const params = new URLSearchParams(url.searchParams);
	for (const [name, value] of Object.entries(changes)) {
		if (value === undefined) params.delete(name);
		else params.set(name, value);
	}
	return new URLSearchParams([...params].filter(([, value]) => value !== ""));
}

function hrefWith(url: URL, changes: QueryChanges) {
	const query = queryWith(url, changes);
	return query.size ? `${url.pathname}?${query}` : url.pathname;
}
