import { eq } from "drizzle-orm";
import { s } from "@src/db/index";
import type { APIRoute } from "astro";

export const POST = (async ({ redirect, locals, request }) => {
	const session = locals.session;
	if (!session) {
		return redirect("/login");
	}

	const newTheme = session.theme === "dark" ? "light" : "dark";

	await locals.db.update(s.sessions).set({ theme: newTheme }).where(eq(s.sessions.id, session.id));

	const referer = request.headers.get("Referer");
	return redirect(referer ?? "/");
}) satisfies APIRoute;
