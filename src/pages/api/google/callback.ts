// pages/login/google/callback.ts
import { createSession, setSessionTokenCookie } from "@auth/session";
import { google, decodeIdToken } from "@auth/oauth";
import type { GoogleTokenResponse } from "@auth/oauth";
import { z } from "astro/zod";

import type { APIContext } from "astro";
import { db, s } from "@db/index";

export const GoogleClaimsSchema = z.object({
  sub: z.string().min(1),
  name: z.string().min(1),
  picture: z.url(),
  email: z.email(),
  email_verified: z.boolean(),
});

export async function GET(context: APIContext): Promise<Response> {
  const storedState = context.cookies.get("google_oauth_state")?.value ?? null;
  const codeVerifier = context.cookies.get("google_code_verifier")?.value ?? null;
  const code = context.url.searchParams.get("code");
  const state = context.url.searchParams.get("state");

  if (storedState === null || codeVerifier === null || code === null || state === null) {
    return new Response("Please restart the process.", {
      status: 400,
    });
  }
  if (storedState !== state) {
    return new Response("Please restart the process.", {
      status: 400,
    });
  }

  let tokens: GoogleTokenResponse;
  try {
    tokens = await google.validateAuthorizationCode(code, codeVerifier);
    context.cookies.delete("google_oauth_state", { path: "/" });
    context.cookies.delete("google_code_verifier", { path: "/" });
  } catch (e) {
    return new Response("Please restart the process.", {
      status: 400,
    });
  }

  let claims: z.infer<typeof GoogleClaimsSchema>;
  try {
    const raw = decodeIdToken(tokens.id_token);
    claims = GoogleClaimsSchema.parse(raw);
  } catch (e) {
    if (e instanceof z.ZodError) {
      return new Response(e.message, {
        status: 400,
      });
    }
    return new Response("Failed to parse claim", {
      status: 400,
    });
  }

  const googleId = claims.sub;
  const username = claims.name;
  const picture = claims.picture;
  const email = claims.email;

  // Verify that a user with id does not already exist
  const existingUser = await db.query.users.findFirst({ where: { googleId: googleId } });

  if (existingUser) {
    const session = await createSession(existingUser.id);
    setSessionTokenCookie(context.cookies, session.token, session.lastVerifiedAt);
    return context.redirect("/");
  }

  const user = await db
    .insert(s.users)
    .values({
      googleId: googleId,
      username: username,
      email: email,
    })
    .returning()
    .then((v) => v.at(0));

  if (!user) {
    return new Response("Database issue when inserting new", {
      status: 500,
    });
  }

  const session = await createSession(user.id);
  setSessionTokenCookie(context.cookies, session.token, session.lastVerifiedAt);
  return context.redirect("/");
}
