import { DB_FILE_NAME } from "astro:env/server";
import { createDatabase } from "@src/db";
import { createClient } from "@src/db/client";
import { getSessionAndUserFromCookie } from "@src/auth/session";
import { defineMiddleware, sequence } from "astro:middleware";
import { getActionContext } from "astro:actions";
import { compressMiddleware } from "@src/middleware/compress";
import { hasStringRedirect } from "@src/validation/type-guards";

const db = createDatabase(createClient(DB_FILE_NAME));

const sessionMiddleware = defineMiddleware(async (context, next) => {

  if (context.isPrerendered) return next();

	const requestedAt = new Date();
	context.locals.db = db;
	const session = await getSessionAndUserFromCookie(context.cookies, db);
	context.locals.session = session;


	if (!session) return next()

	const { action, setActionResult, serializeActionResult } = getActionContext(context);
	if (action?.calledFrom === "form") {
		const actionResult = await action.handler();

		await context.locals.db.mutations.sessions.setActionData(session.id, {
			actionName: action.name,
			actionResult: serializeActionResult(actionResult),
		});

		if (actionResult.error) {
			const referer = context.request.headers.get("Referer");
			if (referer) {
				return context.redirect(referer);
			}
		}

		if (hasStringRedirect(actionResult.data)) {
			return context.redirect(actionResult.data.redirect);
		}

		return context.redirect(context.originPathname);
	}

	if (context.request.method === "GET" && session.actionData) {

		await context.locals.db.mutations.sessions.setActionData(session.id, null);

		setActionResult(session.actionData.actionName, session.actionData.actionResult);
	}

	const response = await next();

	if (!context.routePattern.startsWith("/api/logout")) {
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

		setImmediate(() => {
			db.mutations.history.record(entry).catch((error: unknown) => {
				console.error("Could not record history entry", entry, error);
			});
		});
	}

	return response;
});

export const onRequest = sequence(compressMiddleware, sessionMiddleware);
