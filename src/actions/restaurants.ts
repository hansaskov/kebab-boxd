import { defineAction } from "astro:actions";
import { orThrow, requirePermission, requireSession } from "@src/actions/authorize";
import type { Collection } from "@src/db/mutations/restaurants";
import { restaurantTargetSchema, suggestionSchema } from "@src/validation/restaurant";

function collectAction(write: "collect" | "uncollect", collection: Collection) {
  return defineAction({
    accept: "form",
    input: restaurantTargetSchema,
    handler: async ({ restaurantId }, { locals }) => {
      orThrow(await locals.db.mutations.restaurants[write](requireSession(locals).user.id, restaurantId, collection));
    },
  });
}

export const restaurantActions = {
  favorite: collectAction("collect", "favorites"),
  unfavorite: collectAction("uncollect", "favorites"),
  addToBucketList: collectAction("collect", "bucketList"),
  removeFromBucketList: collectAction("uncollect", "bucketList"),
  suggest: defineAction({
    accept: "form",
    input: suggestionSchema,
    handler: async ({ link }, { locals }) => {
      const { user } = requireSession(locals);
      requirePermission(user, "restaurant:suggest");
      orThrow(await locals.db.mutations.suggestionQueue.queue(user.id, link));
    },
  }),
};
