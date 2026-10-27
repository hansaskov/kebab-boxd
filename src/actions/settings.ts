import { ActionError, defineAction } from "astro:actions";
import { z } from "astro/zod";
import { pronouns } from "@src/data/pronouns";
import { deleteSessionTokenCookie } from "@src/auth/session";
import { authorizeTargetUser, refusedSinceRequestStarted } from "@src/actions/authorize";
import { settingsHref } from "@src/hrefs";
import { usernameSchema } from "@src/validation/username";
import { coordinatesSchema } from "@src/validation/coordinates";
import { maxPictureBytes } from "@src/validation/review";

export const updateAccountSchema = z.object({
  currentUsername: z.string().trim().min(1).max(50),
  fullname: z.string().trim().min(3).max(50),
  username: usernameSchema,
  pronoun: z.enum(pronouns).nullable(),
  bio: z.string().trim().max(200).nullable(),
});

export const updateProfilePictureSchema = z.object({
  currentUsername: z.string().trim().min(1).max(50),
  picture: z
    .instanceof(File)
    .refine((file) => file.size > 0, "Choose a picture.")
    .refine((file) => file.size <= maxPictureBytes, "A picture can be at most 10 MB."),
});

export const updateLocationSchema = z.object({
  currentUsername: z.string().trim().min(1).max(50),
  location: coordinatesSchema.nullable(),
});

export const updateNotificationsSchema = z.object({
  currentUsername: z.string().trim().min(1).max(50),
  followNotifications: z.boolean(),
  likeNotifications: z.boolean(),
  suggestionNotifications: z.boolean(),
});

export const currentUserSchema = z.object({
  currentUsername: z.string().trim().min(1).max(50),
});

export const deleteAccountSchema = z
  .object({
    currentUsername: z.string().trim().min(1).max(50),
    confirmation: z.string().trim().min(1).max(50),
  })
  .refine((input) => input.confirmation === input.currentUsername, {
    message: "Type your username exactly as shown.",
    path: ["confirmation"],
  });

export const settingsActions = {
  updateSettings: defineAction({
    accept: "form",
    input: updateAccountSchema,
    handler: async (input, context) => {
      const { targetUser } = await authorizeTargetUser(
        context.locals,
        input.currentUsername,
        "user:edit-settings",
      );

      const result = await context.locals.db.mutations.users.updateProfile(targetUser.id, {
        fullname: input.fullname,
        username: input.username,
        pronoun: input.pronoun,
        bio: input.bio || null,
      });

      if (result === "username-taken") {
        throw new ActionError({
          code: "CONFLICT",
          message: "Username is already taken.",
        });
      }

      return { redirect: settingsHref(input.username) };
    },
  }),
  updateProfilePicture: defineAction({
    accept: "form",
    input: updateProfilePictureSchema,
    handler: async (input, context) => {
      const { session, targetUser } = await authorizeTargetUser(context.locals, input.currentUsername, "user:edit-settings");

      const result = await context.locals.db.mutations.users.setProfilePicture(targetUser.id, input.picture, session.user.id);

      if (result === "refused") throw refusedSinceRequestStarted();
      if (result === "invalid-picture") {
        throw new ActionError({ code: "BAD_REQUEST", message: "The file is not a picture. Use JPEG, PNG, WebP, AVIF or GIF." });
      }

      return { redirect: settingsHref(targetUser.username) };
    },
  }),
  removeProfilePicture: defineAction({
    accept: "form",
    input: currentUserSchema,
    handler: async (input, context) => {
      const { session, targetUser } = await authorizeTargetUser(context.locals, input.currentUsername, "user:edit-settings");

      if ((await context.locals.db.mutations.users.removeProfilePicture(targetUser.id, session.user.id)) === "refused") {
        throw refusedSinceRequestStarted();
      }

      return { redirect: settingsHref(targetUser.username) };
    },
  }),
  updateLocation: defineAction({
    accept: "form",
    input: updateLocationSchema,
    handler: async (input, context) => {
      const { session, targetUser } = await authorizeTargetUser(context.locals, input.currentUsername, "user:edit-settings");

      if ((await context.locals.db.mutations.users.setLocation(targetUser.id, input.location, session.user.id)) === "refused") {
        throw refusedSinceRequestStarted();
      }

      return { redirect: settingsHref(targetUser.username) };
    },
  }),
  updateNotifications: defineAction({
    accept: "form",
    input: updateNotificationsSchema,
    handler: async ({ currentUsername, ...preferences }, context) => {
      const { session, targetUser } = await authorizeTargetUser(context.locals, currentUsername, "user:edit-settings");

      if ((await context.locals.db.mutations.users.setNotificationPreferences(targetUser.id, preferences, session.user.id)) === "refused") {
        throw refusedSinceRequestStarted();
      }

      return { redirect: settingsHref(targetUser.username) };
    },
  }),
  signOutEverywhere: defineAction({
    accept: "form",
    input: currentUserSchema,
    handler: async (input, context) => {
      const { session, targetUser } = await authorizeTargetUser(
        context.locals,
        input.currentUsername,
        "user:manage-sessions",
      );

      await context.locals.db.mutations.sessions.deleteAllForUser(targetUser.id);

      if (session.user.id !== targetUser.id) {
        return { redirect: settingsHref(targetUser.username) };
      }

      deleteSessionTokenCookie(context.cookies);

      return { redirect: "/login" };
    },
  }),
  deleteAccount: defineAction({
    accept: "form",
    input: deleteAccountSchema,
    handler: async (input, context) => {
      const { session, targetUser } = await authorizeTargetUser(
        context.locals,
        input.currentUsername,
        "user:delete-account",
      );

      const result = await context.locals.db.mutations.users.delete(targetUser.id, session.user.id);

      if (result === "refused") {
        throw new ActionError({
          code: "CONFLICT",
          message: "Your role changed. Reload the page and try again.",
        });
      }

      deleteSessionTokenCookie(context.cookies);

      return { redirect: "/login?notice=account-deleted" };
    },
  }),
};
