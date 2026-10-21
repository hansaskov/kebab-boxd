import { deleteSessionTokenCookie } from "@src/auth/session";
import type { APIRoute } from "astro";

export const POST = (async ({ cookies, redirect, locals }) => {
	const session = locals.session;

	if (!session) {
		return redirect("/login");
	}

	await locals.db.mutations.sessions.delete(session.id);
	deleteSessionTokenCookie(cookies);

	// Pages prefetched or prerendered while signed in would otherwise be shown after sign-out.
	return new Response(null, {
		status: 302,
		headers: {
			Location: "/login",
			"Cache-Control": "no-store",
			"Clear-Site-Data": "\"prefetchCache\", \"prerenderCache\"",
		},
	});
}) satisfies APIRoute;
