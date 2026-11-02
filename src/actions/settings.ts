import { defineAction } from "astro:actions";
import { z } from "astro/zod";
import { pronouns } from "@src/data/pronouns";
import { deleteSessionTokenCookie } from "@src/auth/session";
import { orThrow, requireSession } from "@src/actions/authorize";
import { settingsHref } from "@src/hrefs";
import { usernameSchema } from "@src/validation/username";
import { coordinatesSchema } from "@src/validation/coordinates";
import { maxPictureBytes } from "@src/validation/review";

// The account whose settings the form changes, which an admin may change for someone else.
export const currentUserSchema = z.object({
  currentUsername: z.string().trim().min(1).max(50),
});

export const updateAccountSchema = currentUserSchema.extend({
  fullname: z.string().trim().min(3).max(50),
  username: usernameSchema,
  pronoun: z.enum(pronouns).nullable(),
  bio: z.string().trim().max(200).nullable(),
});

export const updateProfilePictureSchema = currentUserSchema.extend({
  picture: z
    .instanceof(File)
    .refine((file) => file.size > 0, "Choose a picture.")
    .refine((file) => file.size <= maxPictureBytes, "A picture can be at most 10 MB."),
});

export const updateLocationSchema = currentUserSchema.extend({
  location: coordinatesSchema.nullable(),
});

export const updateNotificationsSchema = currentUserSchema.extend({
  followNotifications: z.boolean(),
  likeNotifications: z.boolean(),
  suggestionNotifications: z.boolean(),
});

export const deleteAccountSchema = currentUserSchema
  .extend({ confirmation: z.string().trim().min(1).max(50) })
  .refine((input) => input.confirmation === input.currentUsername, {
    message: "Type your username exactly as shown.",
    path: ["confirmation"],
  });

function account(locals: App.Locals) {
  return { actor: requireSession(locals).user, users: locals.db.users };
}

export const settingsActions = {
  updateSettings: defineAction({
    accept: "form",
    input: updateAccountSchema,
    handler: async ({ currentUsername, bio, ...profile }, { locals }) => {
      const { actor, users } = account(locals);
      orThrow(await users.updateProfile(actor.id, currentUsername, { ...profile, bio: bio || null }));
      return { redirect: settingsHref(profile.username) };
    },
  }),
  updateProfilePicture: defineAction({
    accept: "form",
    input: updateProfilePictureSchema,
    handler: async ({ currentUsername, picture }, { locals }) => {
      const { actor, users } = account(locals);
      const user = orThrow(await users.setProfilePicture(actor.id, currentUsername, picture));
      return { redirect: settingsHref(user.username) };
    },
  }),
  removeProfilePicture: defineAction({
    accept: "form",
    input: currentUserSchema,
    handler: async ({ currentUsername }, { locals }) => {
      const { actor, users } = account(locals);
      const user = orThrow(await users.removeProfilePicture(actor.id, currentUsername));
      return { redirect: settingsHref(user.username) };
    },
  }),
  updateLocation: defineAction({
    accept: "form",
    input: updateLocationSchema,
    handler: async ({ currentUsername, location }, { locals }) => {
      const { actor, users } = account(locals);
      const user = orThrow(await users.setLocation(actor.id, currentUsername, location));
      return { redirect: settingsHref(user.username) };
    },
  }),
  updateNotifications: defineAction({
    accept: "form",
    input: updateNotificationsSchema,
    handler: async ({ currentUsername, ...preferences }, { locals }) => {
      const { actor, users } = account(locals);
      const user = orThrow(await users.setNotificationPreferences(actor.id, currentUsername, preferences));
      return { redirect: settingsHref(user.username) };
    },
  }),
  signOutEverywhere: defineAction({
    accept: "form",
    input: currentUserSchema,
    handler: async ({ currentUsername }, { locals, cookies }) => {
      const { actor, users } = account(locals);
      const user = orThrow(await users.signOutEverywhere(actor.id, currentUsername));
      if (actor.id !== user.id) return { redirect: settingsHref(user.username) };
      deleteSessionTokenCookie(cookies);
      return { redirect: "/login" };
    },
  }),
  deleteAccount: defineAction({
    accept: "form",
    input: deleteAccountSchema,
    handler: async ({ currentUsername }, { locals, cookies }) => {
      const { actor, users } = account(locals);
      orThrow(await users.delete(actor.id, currentUsername));
      deleteSessionTokenCookie(cookies);
      return { redirect: "/login?notice=account-deleted" };
    },
  }),
};
