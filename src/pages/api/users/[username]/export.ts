import type { APIRoute } from "astro";
import { can } from "@src/auth/permissions";
import { signInHref } from "@src/hrefs";

export const GET = (async ({ params, locals: { db, session }, redirect, rewrite }) => {
	if (!session) {
		return redirect(signInHref(undefined, "download-data"));
	}

	// The data comes with the user, in one trip to the database, and is sent only when the viewer may download it.
	const { user, data } = params.username
		? await db.load({ user: db.users.findByUsername(params.username), data: db.personalData.findByUsername(params.username) })
		: { user: undefined, data: undefined };

	if (!user) {
		return rewrite("/404");
	}

	if (!can(session.user, "user:export-data", user)) {
		return rewrite("/403");
	}

	if (!data) {
		return rewrite("/404");
	}

	const exportedAt = new Date();
	const filename = `kebab-boxd-${user.username}-${exportedAt.toISOString().slice(0, 10)}.json`;

	return new Response(JSON.stringify({ exportedAt, user: data }, null, 2), {
		headers: {
			"Content-Type": "application/json; charset=utf-8",
			"Content-Disposition": `attachment; filename="${filename}"`,
			"Cache-Control": "no-store",
		},
	});
}) satisfies APIRoute;
