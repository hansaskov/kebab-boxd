import type { APIRoute } from "astro";
import { redirectClearingSpeculations } from "@src/middleware/speculations";

export const POST = (async ({ redirect, locals: {db, session}, request }) => {

	if (!session) {
		return redirect("/login");
	}
	const newTheme = session.theme === "dark" ? "light" : "dark";

	await db.mutations.sessions.setTheme(session.id, newTheme);

	const referer = request.headers.get("Referer");

	return redirectClearingSpeculations(referer ?? "/");

}) satisfies APIRoute;
