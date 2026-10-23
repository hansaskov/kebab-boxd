
export const pageSizes = [10, 25, 50, 100] as const;
export const defaultPageSize = 25;

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

export interface PageNavigation {
	rows: number;
	previousHref: string | undefined;
	nextHref: string | undefined;
	rowsOptions: { rows: number; href: string }[];
}

type QueryChanges = Record<string, string | undefined>;

export function parsePageRequest(url: URL): PageRequest {
	const params = url.searchParams;
	const rows = Number(params.get("rows"));
	const limit = pageSizes.find((size) => size === rows) ?? defaultPageSize;
	const after = params.get("after");
	const before = params.get("before");

	if (after && !before) return { limit, cursor: { after } };
	if (before && !after) return { limit, cursor: { before } };
	return { limit, cursor: undefined };
}

export function pageNavigation(url: URL, { items, previous, next }: Page<unknown>): PageNavigation | undefined {
	if (items.length === 0 && !previous) return undefined;

	const { limit, cursor } = parsePageRequest(url);
	const href = (to: Cursor | undefined, rows: number) =>
		hrefWith(url, {
			rows: rows === defaultPageSize ? undefined : String(rows),
			after: to && "after" in to ? to.after : undefined,
			before: to && "before" in to ? to.before : undefined,
		});

	return {
		rows: limit,
		previousHref: previous && href(previous, limit),
		nextHref: next && href(next, limit),
		rowsOptions: pageSizes.map((rows) => ({ rows, href: href(cursor, rows) })),
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
