import { DB_FILE_NAME } from "astro:env/server";
import { createDrizzleDatabase, s } from "@src/db";
import { getSessionAndUserFromCookie } from "@src/auth/session";
import { defineMiddleware } from "astro:middleware";
import { getActionContext } from "astro:actions";
import { eq } from "drizzle-orm";

const db = createDrizzleDatabase(DB_FILE_NAME);

export const onRequest = defineMiddleware(async (context, next) => {

	// Skip requests for prerendered pages
  	if (context.isPrerendered) return next();

	context.locals.db = db;
	const session = await getSessionAndUserFromCookie(context.cookies, db);
	context.locals.session = session;

	// Form action request. 
	const { action, setActionResult, serializeActionResult, deserializeActionResult } = getActionContext(context);
	if (action?.calledFrom === "form") {
		const actionResult = await action.handler();
		const serializedActionResult = serializeActionResult(actionResult);

		if (session) {
			await context.locals.db
				.update(s.sessions)
				.set({
					actionData: Buffer.from(
						JSON.stringify({
							actionName: action.name,
							actionResult: serializedActionResult,
						}),
					),
				})
				.where(eq(s.sessions.id, session.id));
		}

		// Redirect back to the previous page on error
		if (actionResult.error) {
			const referer = context.request.headers.get("Referer");
			if (!referer) {
				throw new Error("Internal: Referer unexpectedly missing from Action POST request.");
			}
			return context.redirect(referer);
		}

		// Redirect to the destination page on success
		return context.redirect(context.originPathname);
	}

	// Page after form action 
	if (context.request.method === "GET" && session?.actionData) {
		const { actionName, actionResult } = JSON.parse(session.actionData.toString());
		const deserializedActionResult = deserializeActionResult(actionResult);

		// Clear the action data so it is available only once.
		await context.locals.db
			.update(s.sessions)
			.set({ actionData: null })
			.where(eq(s.sessions.id, session.id));

		setActionResult(actionName, serializeActionResult(deserializedActionResult));
	}

	return next();
});
