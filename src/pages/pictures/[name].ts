import type { APIRoute } from "astro";
import { pictureContentType } from "@src/pictures/store";

export const GET = (async ({ params, locals: { db }, rewrite }) => {
	if (!params.name) {
		return rewrite("/404");
	}

	const bytes = await db.load(db.pictures.read(params.name));
	if (!bytes) {
		return rewrite("/404");
	}

	return new Response(new Uint8Array(bytes), {
		headers: {
			"Content-Type": pictureContentType,
			"Content-Length": String(bytes.byteLength),
			"Cache-Control": "private, max-age=31536000, immutable",
			"X-Content-Type-Options": "nosniff",
		},
	});
}) satisfies APIRoute;
