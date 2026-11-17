import type { APIRoute } from "astro";
import { isProblem } from "@src/db/problem";
import { refusalPage, signInHref } from "@src/hrefs";

export const GET = (async ({ params, locals, redirect, rewrite }) => {
	const { db } = locals;
	const { data } = await db.load({ data: params.username ? db.personalData.exportFor(params.username, db.viewer) : undefined });
	const session = await locals.session();
	if (!session) {
		return redirect(signInHref(undefined, "download-data"));
	}
	if (isProblem(data)) {
		return rewrite(refusalPage[data.problem]);
	}
	if (!data) {
		return rewrite("/404");
	}

	const exportedAt = new Date();
	const filename = `kebab-boxd-${data.username}-${exportedAt.toISOString().slice(0, 10)}.json`;

	return new Response(JSON.stringify({ exportedAt, user: data }, null, 2), {
		headers: {
			"Content-Type": "application/json; charset=utf-8",
			"Content-Disposition": `attachment; filename="${filename}"`,
			"Cache-Control": "no-store",
		},
	});
}) satisfies APIRoute;
