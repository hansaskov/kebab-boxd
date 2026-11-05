import { defineAction } from "astro:actions";
import { z } from "astro/zod";
import { pronouns } from "@src/data/pronouns";
import { orThrow, requireSession } from "@src/actions/authorize";
import { settingsHref } from "@src/hrefs";
import { usernameSchema } from "@src/validation/username";
import { coordinatesSchema } from "@src/validation/coordinates";
import { requiredPictureSchema } from "@src/validation/picture";

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
  picture: requiredPictureSchema,
});

export const updateLocationSchema = currentUserSchema.extend({
  location: coordinatesSchema.nullable(),
});

export const updatePrivacySchema = currentUserSchema.extend({
  isPrivate: z.boolean(),
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

export const settingsActions = {
  updateSettings: defineAction({
    accept: "form",
    input: updateAccountSchema,
    handler: async ({ currentUsername, bio, ...profile }, { locals }) => {
      orThrow(await locals.db.users.updateProfile(requireSession(locals).user.id, currentUsername, { ...profile, bio: bio || null }));
      // The address of the settings holds the username, which may have changed.
      return { redirect: settingsHref(profile.username, "profile") };
    },
  }),
  updateProfilePicture: defineAction({
    accept: "form",
    input: updateProfilePictureSchema,
    handler: async ({ currentUsername, picture }, { locals }) => {
      const user = orThrow(await locals.db.users.setProfilePicture(requireSession(locals).user.id, currentUsername, picture));
      return { redirect: settingsHref(user.username, "profile") };
    },
  }),
  removeProfilePicture: defineAction({
    accept: "form",
    input: currentUserSchema,
    handler: async ({ currentUsername }, { locals }) => {
      const user = orThrow(await locals.db.users.removeProfilePicture(requireSession(locals).user.id, currentUsername));
      return { redirect: settingsHref(user.username, "profile") };
    },
  }),
  updateLocation: defineAction({
    accept: "form",
    input: updateLocationSchema,
    handler: async ({ currentUsername, location }, { locals }) => {
      const user = orThrow(await locals.db.users.setLocation(requireSession(locals).user.id, currentUsername, location));
      return { redirect: settingsHref(user.username, "location") };
    },
  }),
  updatePrivacy: defineAction({
    accept: "form",
    input: updatePrivacySchema,
    handler: async ({ currentUsername, isPrivate }, { locals }) => {
      const user = orThrow(await locals.db.users.setPrivacy(requireSession(locals).user.id, currentUsername, isPrivate));
      return { redirect: settingsHref(user.username, "profile") };
    },
  }),
  updateNotifications: defineAction({
    accept: "form",
    input: updateNotificationsSchema,
    handler: async ({ currentUsername, ...preferences }, { locals }) => {
      const user = orThrow(await locals.db.users.setNotificationPreferences(requireSession(locals).user.id, currentUsername, preferences));
      return { redirect: settingsHref(user.username, "notifications") };
    },
  }),
  // The sessions are gone, so the next page finds none for the cookie and removes it.
  signOutEverywhere: defineAction({
    accept: "form",
    input: currentUserSchema,
    handler: async ({ currentUsername }, { locals }) => {
      const actorId = requireSession(locals).user.id;
      const user = orThrow(await locals.db.users.signOutEverywhere(actorId, currentUsername));
      return { redirect: user.id === actorId ? "/login" : settingsHref(user.username, "security") };
    },
  }),
  deleteAccount: defineAction({
    accept: "form",
    input: deleteAccountSchema,
    handler: async ({ currentUsername }, { locals }) => {
      orThrow(await locals.db.users.delete(requireSession(locals).user.id, currentUsername));
      return { redirect: "/login?notice=account-deleted" };
    },
  }),
};
