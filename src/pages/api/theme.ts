import { getSessionFromCookie } from "@auth/session";
import { eq } from "drizzle-orm";
import { s } from "@db/index";
import type { APIRoute } from "astro";

export const POST = (async ({ cookies, redirect, locals, request }) => {
	const session = await getSessionFromCookie(cookies, locals.db);
	if (!session) {
		return redirect("/login");
	}

	const newTheme = session.theme === "dark" ? "light" : "dark";

	await locals.db.update(s.sessions).set({ theme: newTheme }).where(eq(s.sessions.id, session.id));

	const referer = request.headers.get("Referer");
	return redirect(referer ?? "/");
}) satisfies APIRoute;
