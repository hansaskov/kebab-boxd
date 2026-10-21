import { ActionError, defineAction } from "astro:actions";
import { z } from "astro/zod";
import { pronouns } from "@src/data/pronouns";
import { deleteSessionTokenCookie } from "@src/auth/session";
import type { SessionWithUser } from "@src/auth/session";
import type { Database } from "@src/db";
import { usernameSchema } from "@src/validation/username";

export const updateAccountSchema = z.object({
  currentUsername: z.string().trim().min(1).max(50),
  fullname: z.string().trim().min(3).max(50),
  username: usernameSchema,
  pronoun: z.enum(pronouns).nullable(),
  bio: z.string().trim().max(200).nullable(),
});

export const signOutEverywhereSchema = z.object({
  currentUsername: z.string().trim().min(1).max(50),
});

/** Finds the user a settings form targets, and checks the signed-in user may change it. */
async function findEditableUser(session: SessionWithUser, db: Database, username: string) {
  if (!session) {
    throw new ActionError({
      code: "UNAUTHORIZED",
      message: "You must be signed in.",
    });
  }

  const targetUser = await db.queries.users.findByUsername(username);

  if (!targetUser) {
    throw new ActionError({
      code: "NOT_FOUND",
      message: `User "${username}" not found.`,
    });
  }

  if (session.user.role !== "admin" && session.user.id !== targetUser.id) {
    throw new ActionError({
      code: "FORBIDDEN",
      message: "You are not allowed to change this profile.",
    });
  }

  return { session, targetUser };
}

export const server = {
  updateSettings: defineAction({
    accept: "form",
    input: updateAccountSchema,
    handler: async (input, context) => {
      const { targetUser } = await findEditableUser(
        context.locals.session,
        context.locals.db,
        input.currentUsername,
      );

      const result = await context.locals.db.mutations.users.updateProfile(targetUser.id, {
        fullname: input.fullname,
        username: input.username,
        pronoun: input.pronoun,
        bio: input.bio,
      });

      if (result === "username-taken") {
        throw new ActionError({
          code: "CONFLICT",
          message: "Username is already taken.",
        });
      }

      return { redirect: `/${encodeURIComponent(input.username)}/settings` };
    },
  }),
  signOutEverywhere: defineAction({
    accept: "form",
    input: signOutEverywhereSchema,
    handler: async (input, context) => {
      const { session, targetUser } = await findEditableUser(
        context.locals.session,
        context.locals.db,
        input.currentUsername,
      );

      await context.locals.db.mutations.sessions.deleteAllForUser(targetUser.id);

      // An admin who signs out another user keeps their own session.
      if (session.user.id !== targetUser.id) {
        return { redirect: `/${encodeURIComponent(targetUser.username)}/settings` };
      }

      deleteSessionTokenCookie(context.cookies);

      return { redirect: "/login" };
    },
  }),
};
