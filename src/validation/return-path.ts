// Any origin works: the path is read against it, and only a path that stays on it is kept.
const origin = "https://kebab-boxd.invalid";

// Whether a browser that is sent to the path stays on this site. A path that starts with two slashes, or with a
// slash and a backslash, is the address of another site: `//evil.com` leads to evil.com.
export function isSitePath(path: string): boolean {
	return path.startsWith("/") && !/^\/[/\\]/.test(path);
}

// The path and query of the URL, to send a browser to on this site, or undefined when the path would lead to
// another site. Resolving the dot segments can make such a path: `/.//evil.com` becomes `//evil.com`.
export function sitePath(url: URL): string | undefined {
	return isSitePath(url.pathname) ? `${url.pathname}${url.search}` : undefined;
}

// The page to go back to after signing in, as a path on this site, or undefined. A link to another site is left
// out, so that a link to the sign-in page cannot send the user away from Kebab Boxd. So are the landing page,
// which is for Visitors, the sign-in page and the API, which are no page to go back to. Without one, the user
// goes to their Feed.
export function parseReturnPath(value: string | null | undefined): string | undefined {
	if (!value?.startsWith("/")) return undefined;
	const url = URL.parse(value, origin);
	if (!url || url.origin !== origin) return undefined;
	if (url.pathname === "/" || url.pathname === "/login" || url.pathname.startsWith("/api/")) return undefined;
	return sitePath(url);
}

// The page to go back to after signing in from the page at the URL, or from the path.
export function returnPathOf(from: URL | string | undefined): string | undefined {
	return parseReturnPath(from instanceof URL ? `${from.pathname}${from.search}` : from);
}
