import type { APIContext } from "astro";
import { finishGoogleSignIn } from "@src/auth/providers/google";
import { startSession } from "@src/auth/session";

export async function GET(context: APIContext): Promise<Response> {
	const account = await finishGoogleSignIn(context.cookies, context.url);
	// The login page tells why the user is back, except when they chose to come back.
	if (account === "cancelled") return context.redirect("/login");
	if (typeof account === "string") return context.redirect(`/login?error=${account}`);

	const { db } = context.locals;
	const signIn = await db.accounts.signIn(account);
	switch (signIn.status) {
		case "banned":
			return context.redirect("/login?error=banned");
		case "email-taken":
			return new Response("An account with this email already exists. Sign in with the method you used before.", { status: 409 });
		case "signed-in":
			await startSession(context.cookies, db, signIn.user.id);
			return context.redirect("/");
	}
}
