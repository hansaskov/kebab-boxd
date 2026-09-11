import { DB_FILE_NAME } from "astro:env/server";
import { createDrizzleDatabase, s } from "@src/db";
import { getSessionAndUserFromCookie } from "@src/auth/session";
import { defineMiddleware, sequence } from "astro:middleware";
import { getActionContext } from "astro:actions";
import { eq } from "drizzle-orm";
import { compressMiddleware } from "@src/middleware/compress";
import { hasStringRedirect } from "@src/validation/type-guards";

const db = createDrizzleDatabase(DB_FILE_NAME);

const sessionMiddleware = defineMiddleware(async (context, next) => {

	if (context.isPrerendered) return next();

	context.locals.db = db;
	const session = await getSessionAndUserFromCookie(context.cookies, db);
	context.locals.session = session;


	if (!session) return next()

	const { action, setActionResult, serializeActionResult } = getActionContext(context);
	if (action?.calledFrom === "form") {
		const actionResult = await action.handler();

		await context.locals.db
			.update(s.sessions)
			.set({
				actionData: {
					actionName: action.name,
					actionResult: serializeActionResult(actionResult),
				},
			})
			.where(eq(s.sessions.id, session.id));

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

		await context.locals.db
			.update(s.sessions)
			.set({ actionData: null })
			.where(eq(s.sessions.id, session.id));

		setActionResult(session.actionData.actionName, session.actionData.actionResult);
	}

	return next();
});

export const onRequest = sequence(compressMiddleware, sessionMiddleware);
