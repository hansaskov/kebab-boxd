import { deleteSession, deleteSessionTokenCookie } from "@src/auth/session";
import type { APIRoute } from "astro";

export const POST = (async ({ cookies, redirect, locals }) => {
	const session = locals.session;

	if (!session) {
		return redirect("/login");
	}

	await deleteSession(session.id, locals.db);
	deleteSessionTokenCookie(cookies);

	return redirect("/");
}) satisfies APIRoute;
