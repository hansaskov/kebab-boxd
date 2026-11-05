import type { APIContext } from "astro";
import { rememberReturnPath } from "@src/auth/oauth";
import { googleAuthorizationUrl } from "@src/auth/providers/google";
import { parseReturnPath } from "@src/validation/return-path";

export async function GET(context: APIContext): Promise<Response> {
	rememberReturnPath(context.cookies, parseReturnPath(context.url.searchParams.get("next")));
	return context.redirect(googleAuthorizationUrl(context.cookies).toString());
}
