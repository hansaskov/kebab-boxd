import { waitUntil } from "cloudflare:workers";
import { Resource } from "sst/resource";
import { readSession } from "@src/auth/session";
import { defineMiddleware } from "astro:middleware";
import { getActionContext } from "astro:actions";
import { sameOriginReferer } from "@src/middleware/referer";
import { redirectClearingSpeculations } from "@src/middleware/speculations";
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
	const db = connectDatabase(Resource.Backend as unknown as DatabaseRpc);
	context.locals.db = db;
	const session = await readSession(context.cookies, db);
	context.locals.session = session;

	if (!session) return next();

	const { action } = getActionContext(context);
	if (action?.calledFrom === "form") {
		// The handler reads the body, so a copy is kept to give the form back what the user typed if it fails.
		const submitted = context.request.clone();
		const { data, error } = await action.handler();
		await db.sessions.setActionData(session.id, await toOutcome(action.name, error, submitted));

		const location = !error && hasRedirect(data) ? data.redirect : undefined;
		return redirectClearingSpeculations(location ?? sameOriginReferer(context.request, context.url.origin) ?? context.originPathname);
	}

	if (context.request.method === "GET" && session.actionData) {
		await db.sessions.setActionData(session.id, null);
		context.locals.actionOutcome = session.actionData;
	}

	const response = await next();

	if (isPage(context.routePattern)) {
		const entry = {
			sessionId: session.id,
			requestedAt,
			method: context.request.method,
			route: context.routePattern,
			path: context.url.pathname,
			action: context.url.searchParams.get("_action"),
			status: response.status,
			prefetched: context.request.headers.get("Sec-Purpose")?.startsWith("prefetch") ?? false,
		};

		waitUntil(
			db.history.record(entry).catch((error: unknown) => {
				console.error("Could not record history entry", entry, error);
			}),
		);
	}

	return response;
});

export const onRequest = sessionMiddleware;
