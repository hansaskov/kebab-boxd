import { waitUntil } from "cloudflare:workers";
import { Resource } from "sst/resource";
import { readSession } from "@src/auth/session";
import { defineMiddleware, sequence } from "astro:middleware";
import { getActionContext } from "astro:actions";
import { withSecurityHeaders } from "@src/middleware/security-headers";
import { answerFormOfVisitor, formPage } from "@src/middleware/forms";
import { isSpeculative, redirectClearingSpeculations } from "@src/middleware/speculations";
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

	const { action } = getActionContext(context);
	const sentFrom = () => formPage(context.request, context.url.origin, context.originPathname);

	if (!session) return action?.calledFrom === "form" ? answerFormOfVisitor(sentFrom()) : next();

	if (action?.calledFrom === "form") {
		// The handler reads the body, so a copy is kept to give the form back what the user typed if it fails.
		const submitted = context.request.clone();
		const { data, error } = await action.handler();
		await db.sessions.setActionData(session.id, await toOutcome(action.name, error, submitted));

		const location = !error && hasRedirect(data) ? data.redirect : undefined;
		return redirectClearingSpeculations(location ?? sentFrom());
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

export const onRequest = sequence(securityMiddleware, sessionMiddleware);
