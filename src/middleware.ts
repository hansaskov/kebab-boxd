import { waitUntil } from "cloudflare:workers";
import { Resource } from "sst/resource";
import { readSession } from "@src/auth/session";
import { defineMiddleware, sequence } from "astro:middleware";
import { getActionContext } from "astro:actions";
import { withChangedHeaders } from "@src/middleware/headers";
import { measuringDatabase } from "@src/middleware/server-timing";
import { withSecurityHeaders } from "@src/middleware/security-headers";
import { answerFormOfVisitor, formPage } from "@src/middleware/forms";
import { isSpeculative, redirectClearingSpeculations } from "@src/middleware/speculations";
import { visitorCacheOf } from "@src/middleware/visitor-cache";
import { connectDatabase, type DatabaseRpc } from "@src/db/remote";
import { picturePathPrefix } from "@src/pictures/store";
import { toOutcome } from "@src/actions/outcome";

// The history holds the pages a device opened, not the pictures on them.
function isPage(routePattern: string) {
	return !routePattern.startsWith(picturePathPrefix);
}

function hasRedirect(data: unknown): data is { redirect: string } {
	return typeof data === "object" && data !== null && "redirect" in data && typeof data.redirect === "string";
}

const sessionMiddleware = defineMiddleware(async (context, next) => {
	if (context.isPrerendered) return next();

	const requestedAt = new Date();
	const measured = measuringDatabase(Resource.Backend as unknown as DatabaseRpc);
	const db = connectDatabase(measured.rpc);
	context.locals.db = db;
	// Before the history is written, which happens after the answer and is no part of the wait.
	const timed = (response: Response) => withChangedHeaders(response, (headers) => headers.append("Server-Timing", measured.header()));

	const session = await readSession(context.cookies, db, { takeActionOutcome: context.request.method === "GET" });
	context.locals.session = session;

	const { action } = getActionContext(context);
	const sentFrom = () => formPage(context.request, context.url.origin, context.originPathname);

	if (!session) return timed(action?.calledFrom === "form" ? answerFormOfVisitor(sentFrom()) : await next());

	if (action?.calledFrom === "form") {
		// The handler reads the body, so a copy is kept to give the form back what the user typed if it fails.
		const submitted = context.request.clone();
		const { data, error } = await action.handler();
		await db.sessions.setActionData(session.id, await toOutcome(action.name, data, error, submitted));

		const location = !error && hasRedirect(data) ? data.redirect : undefined;
		return timed(redirectClearingSpeculations(location ?? sentFrom()));
	}

	if (session.actionOutcome) context.locals.actionOutcome = session.actionOutcome;

	const response = timed(await next());

	if (isPage(context.routePattern)) {
		const entry = {
			sessionId: session.id,
			requestedAt,
			method: context.request.method,
			route: context.routePattern,
			path: context.url.pathname,
			action: context.url.searchParams.get("_action"),
			status: response.status,
			prefetched: isSpeculative(context.request),
		};

		waitUntil(
			db.history.record(entry).catch((error: unknown) => {
				console.error("Could not record history entry", entry, error);
			}),
		);
	}

	return response;
});

const securityMiddleware = defineMiddleware(async (_context, next) => withSecurityHeaders(await next()));

// Astro adds the headers of the cache after the middleware, from what it was told, and Cloudflare keeps a page only
// while it says so. Every other response is never kept.
const visitorCacheMiddleware = defineMiddleware(async (context, next) => {
	const response = await next();
	const cache = visitorCacheOf(context.request, response);
	context.cache.set(cache);
	return cache ? withChangedHeaders(response, (headers) => headers.append("Vary", "Cookie")) : response;
});

export const onRequest = sequence(securityMiddleware, visitorCacheMiddleware, sessionMiddleware);
