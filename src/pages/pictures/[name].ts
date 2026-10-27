import type { APIRoute } from "astro";
import { pictureContentType } from "@src/pictures/store";

// A picture never changes under its name, which is random, so the browser may keep it for good. Shared caches
// may not: a profile picture is personal data and must be gone when its account is deleted.
export const GET = (async ({ params, locals: { db }, rewrite }) => {
	const bytes = params.name ? await db.pictures.read(params.name) : undefined;

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
