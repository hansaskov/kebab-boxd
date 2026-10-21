import type { APIRoute } from "astro";

export const POST = (async ({ redirect, locals: {db, session}, request }) => {

	if (!session) {
		return redirect("/login");
	}
	const newTheme = session.theme === "dark" ? "light" : "dark";

	await db.mutations.sessions.setTheme(session.id, newTheme);

	const referer = request.headers.get("Referer");

	return new Response(null, {
		status: 302,
		headers: {
			Location: referer ?? "/",
			"Cache-Control": "no-store",
			"Clear-Site-Data": "\"prefetchCache\", \"prerenderCache\"",
		},
	});

}) satisfies APIRoute;
