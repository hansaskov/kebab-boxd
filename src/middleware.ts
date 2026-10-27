import { DB_FILE_NAME, PICTURES_DIR } from "astro:env/server";
import { createDatabase } from "@src/db";
import { createClient } from "@src/db/client";
import { getSessionAndUserFromCookie } from "@src/auth/session";
import { defineMiddleware, sequence } from "astro:middleware";
import { getActionContext } from "astro:actions";
import { compressMiddleware } from "@src/middleware/compress";
import { sameOriginReferer } from "@src/middleware/referer";
import { redirectClearingSpeculations } from "@src/middleware/speculations";
import { scheduleRetentionPurge } from "@src/retention";
import { scheduleSuggestionQueue } from "@src/suggestion-queue";
import { createPictureStore, picturePathPrefix } from "@src/pictures/store";
import { toOutcome } from "@src/actions/outcome";

const db = createDatabase(createClient(DB_FILE_NAME), createPictureStore(PICTURES_DIR));
const stopRetentionPurge = scheduleRetentionPurge(db);
import.meta.hot?.dispose(stopRetentionPurge);
const stopSuggestionQueue = scheduleSuggestionQueue(db);
import.meta.hot?.dispose(stopSuggestionQueue);

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
	context.locals.db = db;
	const session = await getSessionAndUserFromCookie(context.cookies, db);
	context.locals.session = session;

	if (!session) return next();

	const { action } = getActionContext(context);
	if (action?.calledFrom === "form") {
		// The handler reads the body, so a copy is kept to give the form back what the user typed if it fails.
		const submitted = context.request.clone();
		const { data, error } = await action.handler();
		await db.mutations.sessions.setActionData(session.id, await toOutcome(action.name, error, submitted));

		const location = !error && hasRedirect(data) ? data.redirect : undefined;
		return redirectClearingSpeculations(location ?? sameOriginReferer(context.request, context.url.origin) ?? context.originPathname);
	}

	if (context.request.method === "GET" && session.actionData) {
		await db.mutations.sessions.setActionData(session.id, null);
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

		setImmediate(() => {
			db.mutations.history.record(entry).catch((error: unknown) => {
				console.error("Could not record history entry", entry, error);
			});
		});
	}

	return response;
});

export const onRequest = sequence(compressMiddleware, sessionMiddleware);
