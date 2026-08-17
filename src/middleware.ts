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

	// Skip requests for prerendered pages
	if (context.isPrerendered) return next();

	// Set Locals. 
	context.locals.db = db;
	const session = await getSessionAndUserFromCookie(context.cookies, db);
	context.locals.session = session;


	// Skip request if not authenticated. 
	if (!session) return next()

	// POST --> Redirect --> GET ... (1 / 2). 
	const { action, setActionResult, serializeActionResult } = getActionContext(context);
	if (action?.calledFrom === "form") {
		const actionResult = await action.handler();

		// Save the actionData to user's session. 
		await context.locals.db
			.update(s.sessions)
			.set({
				actionData: {
					actionName: action.name,
					actionResult: serializeActionResult(actionResult),
				},
			})
			.where(eq(s.sessions.id, session.id));

		// Redirect back to the previous page on error
		if (actionResult.error) {
			const referer = context.request.headers.get("Referer");
			if (referer) {
				return context.redirect(referer);
			}
		}

		// Redirect to custom "Redirect" page.
		if (hasStringRedirect(actionResult.data)) {
			return context.redirect(actionResult.data.redirect);
		}

		// Redirect to the destination page on success
		return context.redirect(context.originPathname);
	}

	// POST --> Redirect --> GET ... (2 / 2).
	if (context.request.method === "GET" && session.actionData) {

		// Clear the action data so it is available only once.
		await context.locals.db
			.update(s.sessions)
			.set({ actionData: null })
			.where(eq(s.sessions.id, session.id));

		setActionResult(session.actionData.actionName, session.actionData.actionResult);
	}

	return next();
});

// Compression wraps the other middleware so it runs after the final response is created.
export const onRequest = sequence(compressMiddleware, sessionMiddleware);
