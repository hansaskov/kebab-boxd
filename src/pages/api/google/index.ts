import type { APIContext } from "astro";
import { googleAuthorizationUrl } from "@src/auth/providers/google";

export async function GET(context: APIContext): Promise<Response> {
	return context.redirect(googleAuthorizationUrl(context.cookies).toString());
}
