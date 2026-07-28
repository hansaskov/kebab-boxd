import { deleteSession, deleteSessionTokenCookie, getSessionAndUserFromCookie } from "@auth/session";
import type { APIRoute } from "astro";

export const POST = (async ({ cookies, redirect, locals }) => {
	const session = await getSessionAndUserFromCookie(cookies, locals.db);

	if (!session) {
		return redirect("/login");
	}

	await deleteSession(session.id, locals.db);
	deleteSessionTokenCookie(cookies);

	return redirect("/");
}) satisfies APIRoute;
