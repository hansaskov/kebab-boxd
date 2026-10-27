import { deleteSessionTokenCookie } from "@src/auth/session";
import type { APIRoute } from "astro";
import { redirectClearingSpeculations } from "@src/middleware/speculations";

export const POST = (async ({ cookies, redirect, locals }) => {
	const session = locals.session;

	if (!session) {
		return redirect("/login");
	}

	await locals.db.mutations.sessions.delete(session.id);
	deleteSessionTokenCookie(cookies);

	return redirectClearingSpeculations("/login");
}) satisfies APIRoute;
