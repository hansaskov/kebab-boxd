import type { APIContext } from "astro";
import { BOOTSTRAP_ADMIN_EMAIL } from "astro:env/server";
import { takeReturnPath } from "@src/auth/oauth";
import { finishGoogleSignIn } from "@src/auth/providers/google";
import { newSession, startSession } from "@src/auth/session";
import { feedHref, signInHref } from "@src/hrefs";
import { redirectClearingSpeculations } from "@src/middleware/speculations";

export async function GET(context: APIContext): Promise<Response> {
	const returnPath = takeReturnPath(context.cookies);
	const account = await finishGoogleSignIn(context.cookies, context.url);
	if (account === "cancelled") return context.redirect(signInHref(returnPath));
	if (typeof account === "string") return context.redirect(signInHref(returnPath, account));

	const { db } = context.locals;
	const session = newSession();
	const signIn = await db.load(db.accounts.signIn(account, BOOTSTRAP_ADMIN_EMAIL, session.row));
	switch (signIn.status) {
		case "banned":
			return context.redirect(signInHref(returnPath, "banned"));
		case "email-taken":
			return new Response("An account with this email already exists. Sign in with the method you used before.", { status: 409 });
		case "signed-in":
			startSession(context.cookies, session.token);
			return redirectClearingSpeculations(returnPath ?? feedHref);
	}
}
