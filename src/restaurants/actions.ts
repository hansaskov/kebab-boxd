import { defineAction } from "astro:actions";
import { orThrow, requirePermission, requireSession } from "@src/actions/authorize";
import type { Collection } from "@src/restaurants/collections.db";
import { z } from "astro/zod";
import { idSchema } from "@src/actions/schemas";
import { isGoogleMapsLink } from "@src/restaurants/google-maps";

export const suggestionSchema = z.object({
  link: z
    .string()
    .trim()
    .max(2000)
    .refine(isGoogleMapsLink, "Paste the link Google Maps gives you when you share the restaurant."),
});

export const restaurantTargetSchema = z.object({
  restaurantId: idSchema,
});

function collectAction(write: "add" | "remove", collection: Collection) {
  return defineAction({
    accept: "form",
    input: restaurantTargetSchema,
    handler: async ({ restaurantId }, { locals }) => {
      orThrow(await locals.db.collections[write](requireSession(locals).user.id, restaurantId, collection));
    },
  });
}

export const restaurantActions = {
  favorite: collectAction("add", "favorites"),
  unfavorite: collectAction("remove", "favorites"),
  addToBucketList: collectAction("add", "bucketList"),
  removeFromBucketList: collectAction("remove", "bucketList"),
  suggest: defineAction({
    accept: "form",
    input: suggestionSchema,
    handler: async ({ link }, { locals }) => {
      const { user } = requireSession(locals);
      requirePermission(user, "restaurant:suggest");
      orThrow(await locals.db.suggestionQueue.queue(user.id, link));
    },
  }),
};
