import type { CacheOptions } from "astro";
import { sessionCookieName } from "@src/auth/session";

export const visitorPageMaxAge = 60;
export const visitorPageStaleSeconds = 60;

const keptStatuses = new Set([200, 404]);

function hasSessionCookie(request: Request) {
	const cookies = request.headers.get("Cookie")?.split(";") ?? [];
	return cookies.some((cookie) => cookie.trim().startsWith(`${sessionCookieName}=`));
}

export function visitorCacheOf(request: Request, response: Response): CacheOptions | false {
	const isRead = request.method === "GET" || request.method === "HEAD";
	const isPage = response.headers.get("Content-Type")?.startsWith("text/html") ?? false;
	if (!isRead || !isPage || !keptStatuses.has(response.status) || hasSessionCookie(request)) return false;
	return { maxAge: visitorPageMaxAge, swr: visitorPageStaleSeconds };
}
