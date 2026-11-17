const origin = "https://kebab-boxd.invalid";

export function isSitePath(path: string): boolean {
	return path.startsWith("/") && !/^\/[/\\]/.test(path);
}

export function sitePath(url: URL): string | undefined {
	return isSitePath(url.pathname) ? `${url.pathname}${url.search}` : undefined;
}

export function parseReturnPath(value: string | null | undefined): string | undefined {
	if (!value?.startsWith("/")) return undefined;
	const url = URL.parse(value, origin);
	if (!url || url.origin !== origin) return undefined;
	if (url.pathname === "/" || url.pathname === "/login" || url.pathname.startsWith("/api/")) return undefined;
	return sitePath(url);
}

export function returnPathOf(from: URL | string | undefined): string | undefined {
	return parseReturnPath(from instanceof URL ? `${from.pathname}${from.search}` : from);
}
