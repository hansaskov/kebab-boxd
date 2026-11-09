import type { CacheOptions } from "astro";
import { sessionCookieName } from "@src/auth/session";

// Every Visitor sees the same page at an address, so Cloudflare keeps it and shows it to the next Visitor without
// asking the database. A User sees a page of their own, which is never kept.
//
// The cache of the Worker ignores cookies when it looks for a page, unless the page says that it varies on them.
// A kept page says so, so a request that sends a cookie, such as one of a User, never gets the page of a Visitor.

// How long a kept page is shown, in seconds, and how long after that it is shown once more while a new one is
// made. A change, such as a new Review or a Profile made private, reaches Visitors within both.
export const visitorPageMaxAge = 60;
export const visitorPageStaleSeconds = 60;

// A page, and a page that is not there, which scrapers ask for too. An error or a redirect is not kept.
const keptStatuses = new Set([200, 404]);

function hasSessionCookie(request: Request) {
	const cookies = request.headers.get("Cookie")?.split(";") ?? [];
	return cookies.some((cookie) => cookie.trim().startsWith(`${sessionCookieName}=`));
}

// How Cloudflare may keep the response: for every Visitor, or not at all. A User sends the cookie of their session,
// also one that has ended, whose answer removes it.
export function visitorCacheOf(request: Request, response: Response): CacheOptions | false {
	const isRead = request.method === "GET" || request.method === "HEAD";
	const isPage = response.headers.get("Content-Type")?.startsWith("text/html") ?? false;
	if (!isRead || !isPage || !keptStatuses.has(response.status) || hasSessionCookie(request)) return false;
	return { maxAge: visitorPageMaxAge, swr: visitorPageStaleSeconds };
}
