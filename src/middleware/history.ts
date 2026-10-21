import { defineMiddleware } from "astro:middleware";

// Browsers mark speculative loads with Sec-Purpose (or the older Purpose).
export function isPrefetch(request: Request) {
	const purpose = request.headers.get("Sec-Purpose") ?? request.headers.get("Purpose") ?? "";
	return purpose.includes("prefetch");
}

// The locals of the requests seen so far. A rewrite, such as Astro.rewrite("/404"),
// runs the middleware again with the same locals, and the first run already records
// the path the browser asked for with the final status.
const seen = new WeakSet<App.Locals>();

// Runs before the session middleware so it also sees the redirects that form
// actions return without rendering a page.
export const historyMiddleware = defineMiddleware(async (context, next) => {
	if (context.isPrerendered || isPrefetch(context.request)) return next();

	if (seen.has(context.locals)) return next();
	seen.add(context.locals);

	const requestedAt = new Date();
	const response = await next();

	const session = context.locals.session;
	if (!session) return response;

	const entry = {
		sessionId: session.id,
		requestedAt,
		method: context.request.method,
		route: context.routePattern,
		path: context.url.pathname,
		action: context.url.searchParams.get("_action"),
		status: response.status,
	};
	const db = context.locals.db;

	// node:sqlite writes block the event loop, so the insert waits until the
	// response is on its way. Nothing awaits it, so every error is caught here,
	// including two requests from one session in the same millisecond.
	setImmediate(() => {
		db.mutations.history.record(entry).catch((error: unknown) => {
			console.error("Could not record history entry", entry, error);
		});
	});

	return response;
});
