/**
 * Lists that are shown a page at a time. A page reads which rows to show with `parsePageRequest`,
 * passes the request to a list query made with `cursorList` from `src/db/pagination`, and renders
 * `pageNavigation` of the result with the `Pagination` component.
 *
 * A page starts after or before a row instead of at a position, so rows that are added or removed
 * while someone pages through the list do not make rows repeat or go missing. Links keep the rest
 * of the query, such as a search, as it is.
 */

/** The number of rows a paged list may show, offered in its rows-per-page menu. */
export const pageSizes = [10, 25, 50, 100] as const;
export const defaultPageSize = 25;

/**
 * Where a page starts: right after or right before a row, in the order the list is shown. In a
 * list shown newest first, the page after a row holds older rows. Only the list that wrote a
 * cursor can read it.
 */
export type Cursor = { after: string } | { before: string };

/** Which rows of a list to read. Without a cursor the first page is read. */
export interface PageRequest {
	limit: number;
	cursor: Cursor | undefined;
}

/** One page of a list. */
export interface Page<T> {
	items: T[];
	/** Undefined on the first page. */
	previous: { before: string } | undefined;
	/** Undefined on the last page. */
	next: { after: string } | undefined;
	/** Whether the page starts after the last row, as an old link can. */
	isPastEnd: boolean;
}

/** The links the `Pagination` component shows under a list. */
export interface PageNavigation {
	/** The page size of the page on show. */
	rows: number;
	/** Undefined on the first page. */
	previousHref: string | undefined;
	/** Undefined on the last page. */
	nextHref: string | undefined;
	/** One link per choice of rows per page, each keeping the page in view. */
	rowsOptions: { rows: number; href: string }[];
}

type QueryChanges = Record<string, string | undefined>;

/**
 * Reads `?rows=<n>` and either `?after=<cursor>` or `?before=<cursor>`. Sizes not on offer give the
 * default size, and both cursors at once give the first page.
 */
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

/** The links around the page of the list on show at `url`. Undefined when the list is empty. */
export function pageNavigation(url: URL, { items, previous, next }: Page<unknown>): PageNavigation | undefined {
	// A page past the end has no rows, but still links back.
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
		// Changing the rows per page keeps the page starting where it does.
		rowsOptions: pageSizes.map((rows) => ({ rows, href: href(cursor, rows) })),
	};
}

/** The link to the first page of the list at `url` with some query values changed, such as a filter. */
export function firstPageHref(url: URL, changes: QueryChanges): string {
	return hrefWith(url, { ...changes, after: undefined, before: undefined });
}

/**
 * The query values a form at `url` keeps as hidden inputs, when it changes the values it leaves out
 * as `undefined`. Submitting it starts again from the first page.
 */
export function firstPageFields(url: URL, changes: QueryChanges): [name: string, value: string][] {
	return [...queryWith(url, { ...changes, after: undefined, before: undefined })];
}

/** The query of `url` with some values set, and those that are undefined or empty left out. */
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
