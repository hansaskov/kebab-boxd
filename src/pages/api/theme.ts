import { eq } from "drizzle-orm";
import { s } from "@src/db/index";
import type { APIRoute } from "astro";

export const POST = (async ({ redirect, locals: {db, session}, request }) => {

	if (!session) {
		return redirect("/login");
	}
	const newTheme = session.theme === "dark" ? "light" : "dark";

	await db
		.update(s.sessions)
		.set({ theme: newTheme })
		.where(eq(s.sessions.id, session.id));

	const referer = request.headers.get("Referer");

	return new Response(null, {
		status: 302,
		headers: {
			Location: referer ?? "/",
			"Cache-Control": "no-store",
			"Clear-Site-Data": "\"cache\"",
		},
	});

}) satisfies APIRoute;
