import { defineAction } from "astro:actions";
import { orThrow, requirePermission, requireSession } from "@src/actions/authorize";
import type { Collection } from "@src/db/collections";
import { restaurantTargetSchema, suggestionSchema } from "@src/validation/restaurant";

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
