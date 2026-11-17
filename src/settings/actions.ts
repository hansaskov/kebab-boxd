import { defineAction } from "astro:actions";
import { z } from "astro/zod";
import { pronouns } from "@src/users/users";
import { usernameSchema, requiredPictureSchema } from "@src/actions/schemas";
import { coordinatesPattern, parseCoordinates } from "@src/map/coordinates";
import { orThrow, requireSession } from "@src/actions/authorize";
import { landingHref, landingNoticeHref, settingsHref } from "@src/hrefs";

export const coordinatesTextSchema = z
  .string()
  .trim()
  .max(60)
  .regex(coordinatesPattern, "Write the latitude, a comma and the longitude, such as 55.3959, 10.3883.")
  .refine((text) => parseCoordinates(text) !== undefined, "The latitude must be from -90 to 90 and the longitude from -180 to 180.");

export const coordinatesSchema = coordinatesTextSchema.transform((text) => parseCoordinates(text)!);

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
      const { db } = locals;
      const { user: actor } = await requireSession(locals);
      orThrow(await db.load(db.users.updateProfile(actor.id, currentUsername, { ...profile, bio: bio || null })));
      return { redirect: settingsHref(profile.username, "profile") };
    },
  }),
  updateProfilePicture: defineAction({
    accept: "form",
    input: updateProfilePictureSchema,
    handler: async ({ currentUsername, picture }, { locals }) => {
      const { db } = locals;
      const { user: actor } = await requireSession(locals);
      const user = orThrow(await db.load(db.users.setProfilePicture(actor.id, currentUsername, picture)));
      return { redirect: settingsHref(user.username, "profile") };
    },
  }),
  removeProfilePicture: defineAction({
    accept: "form",
    input: currentUserSchema,
    handler: async ({ currentUsername }, { locals }) => {
      const { db } = locals;
      const { user: actor } = await requireSession(locals);
      const user = orThrow(await db.load(db.users.removeProfilePicture(actor.id, currentUsername)));
      return { redirect: settingsHref(user.username, "profile") };
    },
  }),
  updateLocation: defineAction({
    accept: "form",
    input: updateLocationSchema,
    handler: async ({ currentUsername, location }, { locals }) => {
      const { db } = locals;
      const { user: actor } = await requireSession(locals);
      orThrow(await db.load(db.users.setLocation(actor.id, currentUsername, location)));
    },
  }),
  updatePrivacy: defineAction({
    accept: "form",
    input: updatePrivacySchema,
    handler: async ({ currentUsername, isPrivate }, { locals }) => {
      const { db } = locals;
      const { user: actor } = await requireSession(locals);
      const user = orThrow(await db.load(db.users.setPrivacy(actor.id, currentUsername, isPrivate)));
      return { redirect: settingsHref(user.username, "profile") };
    },
  }),
  updateNotifications: defineAction({
    accept: "form",
    input: updateNotificationsSchema,
    handler: async ({ currentUsername, ...preferences }, { locals }) => {
      const { db } = locals;
      const { user: actor } = await requireSession(locals);
      const user = orThrow(await db.load(db.users.setNotificationPreferences(actor.id, currentUsername, preferences)));
      return { redirect: settingsHref(user.username, "notifications") };
    },
  }),
  signOutEverywhere: defineAction({
    accept: "form",
    input: currentUserSchema,
    handler: async ({ currentUsername }, { locals }) => {
      const { db } = locals;
      const { user: actor } = await requireSession(locals);
      const user = orThrow(await db.load(db.users.signOutEverywhere(actor.id, currentUsername)));
      return { redirect: user.id === actor.id ? landingHref : settingsHref(user.username, "security") };
    },
  }),
  deleteAccount: defineAction({
    accept: "form",
    input: deleteAccountSchema,
    handler: async ({ currentUsername }, { locals }) => {
      const { db } = locals;
      const { user: actor } = await requireSession(locals);
      orThrow(await db.load(db.users.delete(actor.id, currentUsername)));
      return { redirect: landingNoticeHref("account-deleted") };
    },
  }),
};
