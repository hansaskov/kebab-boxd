import type { APIContext } from "astro";
import { BOOTSTRAP_ADMIN_EMAIL } from "astro:env/server";
import { takeReturnPath } from "@src/auth/oauth";
import { finishGoogleSignIn } from "@src/auth/providers/google";
import { startSession } from "@src/auth/session";
import { feedHref, signInHref } from "@src/hrefs";
import { redirectClearingSpeculations } from "@src/middleware/speculations";

export async function GET(context: APIContext): Promise<Response> {
	// A user who is sent back to sign in again keeps the page they came from.
	const returnPath = takeReturnPath(context.cookies);
	const account = await finishGoogleSignIn(context.cookies, context.url);
	// The sign-in page tells why the user is back, except when they chose to come back.
	if (account === "cancelled") return context.redirect(signInHref(returnPath));
	if (typeof account === "string") return context.redirect(signInHref(returnPath, account));

	const { db } = context.locals;
	const signIn = await db.accounts.signIn(account, BOOTSTRAP_ADMIN_EMAIL);
	switch (signIn.status) {
		case "banned":
			return context.redirect(signInHref(returnPath, "banned"));
		case "email-taken":
			return new Response("An account with this email already exists. Sign in with the method you used before.", { status: 409 });
		case "signed-in":
			await startSession(context.cookies, db, signIn.user.id);
			// The pages the browser loaded in advance show the site to a Visitor, so they must go.
			return redirectClearingSpeculations(returnPath ?? feedHref);
	}
}
