import type { APIRoute } from "astro";
import { can } from "@src/auth/permissions";

export const GET = (async ({ params, locals: { db, session }, redirect, rewrite }) => {
	if (!session) {
		return redirect("/login");
	}

	const user = params.username ? await db.queries.users.findByUsername(params.username) : undefined;

	if (!user) {
		return rewrite("/404");
	}

	if (!can(session.user, "user:export-data", user)) {
		return rewrite("/403");
	}

	const data = await db.queries.personalData.findByUser(user.id);

	if (!data) {
		return rewrite("/404");
	}

	const exportedAt = new Date();
	const filename = `kebab-boxd-${user.username}-${exportedAt.toISOString().slice(0, 10)}.json`;

	return new Response(JSON.stringify({ exportedAt, ...data }, null, 2), {
		headers: {
			"Content-Type": "application/json; charset=utf-8",
			"Content-Disposition": `attachment; filename="${filename}"`,
			"Cache-Control": "no-store",
		},
	});
}) satisfies APIRoute;
