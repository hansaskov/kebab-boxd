import { env, waitUntil } from "cloudflare:workers";
import type { APIContext } from "astro";
import { Resource } from "sst/resource";
import { keepSessionCookie, sessionTokenOf } from "@src/auth/session";
import { defineMiddleware, sequence } from "astro:middleware";
import { getActionContext } from "astro:actions";
import { withChangedHeaders } from "@src/middleware/headers";
import { coldStartTiming, measuringDatabase } from "@src/middleware/server-timing";
import { withSecurityHeaders } from "@src/middleware/security-headers";
import { answerFormOfVisitor, formPage } from "@src/middleware/forms";
import { isSpeculative, redirectClearingSpeculations } from "@src/middleware/speculations";
import { visitorCacheOf } from "@src/middleware/visitor-cache";
import { connectDatabase, type DatabaseRpc } from "@src/db/remote";
import { connectPage, openSession, type PageSession } from "@src/db/page-database";
import { picturePathPrefix } from "@src/pictures/store";
import { toOutcome } from "@src/actions/outcome";

function isPage(routePattern: string) {
	return !routePattern.startsWith(picturePathPrefix);
}

function hasRedirect(data: unknown): data is { redirect: string } {
	return typeof data === "object" && data !== null && "redirect" in data && typeof data.redirect === "string";
}

function backend(): DatabaseRpc {
	return env.Database ? env.Database.getByName("main") : (Resource.Backend as unknown as DatabaseRpc);
}

const databaseRpc: DatabaseRpc = {
	call: async (request) => backend().call(request),
};

function pageSessionOf(context: APIContext, token: string | undefined): PageSession {
	if (!token) return { opened: null };
	return {
		toOpen: { token, takeActionOutcome: context.request.method === "GET" && isPage(context.routePattern) },
		onOpened: (session) => {
			keepSessionCookie(context.cookies, token, session);
			if (session?.actionOutcome) context.locals.actionOutcome = session.actionOutcome;
		},
	};
}

const sessionMiddleware = defineMiddleware(async (context, next) => {
	if (context.isPrerendered) return next();

	const requestedAt = new Date();
	const measured = measuringDatabase(databaseRpc);
	const db = connectDatabase(measured.rpc);
	const timed = (response: Response) => withChangedHeaders(response, (headers) => headers.append("Server-Timing", measured.header()));
	const token = sessionTokenOf(context.cookies);
	const page = connectPage(measured.rpc, pageSessionOf(context, token));
	context.locals.db = page.db;
	context.locals.session = page.session;

	const { action } = getActionContext(context);
	if (action?.calledFrom === "form") {
		const sentFrom = formPage(context.request, context.url.origin, context.originPathname);
		const session = token ? await openSession(measured.rpc, { token, takeActionOutcome: false }) : null;
		if (token) keepSessionCookie(context.cookies, token, session);
		if (!session) return timed(answerFormOfVisitor(sentFrom));

		const pageOfForm = connectPage(measured.rpc, { opened: session });
		context.locals.db = pageOfForm.db;
		context.locals.session = pageOfForm.session;

		const submitted = context.request.clone();
		const { data, error } = await action.handler();
		await db.load(db.sessions.setActionData(session.id, await toOutcome(action.name, data, error, submitted)));

		const location = !error && hasRedirect(data) ? data.redirect : undefined;
		return timed(redirectClearingSpeculations(location ?? sentFrom));
	}

	const response = timed(await next());

	if (token && isPage(context.routePattern)) {
		const entry = {
			requestedAt,
			method: context.request.method,
			route: context.routePattern,
			path: context.url.pathname,
			action: context.url.searchParams.get("_action"),
			status: response.status,
			prefetched: isSpeculative(context.request),
		};

		const recordHistory = async () => {
			const opened = page.openedSession();
			const session = opened === undefined ? await openSession(measured.rpc, { token, takeActionOutcome: false }) : opened;
			if (session) await db.load(db.history.record({ ...entry, sessionId: session.id }));
		};

		waitUntil(
			recordHistory().catch((error: unknown) => {
				console.error("Could not record history entry", entry, error);
			}),
		);
	}

	return response;
});

const securityMiddleware = defineMiddleware(async (_context, next) => withSecurityHeaders(await next()));

const coldStartMiddleware = defineMiddleware(async (_context, next) => {
	const timing = coldStartTiming();
	const response = await next();
	return timing ? withChangedHeaders(response, (headers) => headers.append("Server-Timing", timing)) : response;
});

const visitorCacheMiddleware = defineMiddleware(async (context, next) => {
	const response = await next();
	const cache = visitorCacheOf(context.request, response);
	context.cache.set(cache);
	return cache ? withChangedHeaders(response, (headers) => headers.append("Vary", "Cookie")) : response;
});

export const onRequest = sequence(coldStartMiddleware, securityMiddleware, visitorCacheMiddleware, sessionMiddleware);
