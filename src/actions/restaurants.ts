import { ActionError, defineAction } from "astro:actions";
import { authorize, authorizeRestaurant, refusedSinceRequestStarted, requireSession } from "@src/actions/authorize";
import type { Collection } from "@src/db/mutations/restaurants";
import { restaurantHref } from "@src/hrefs";
import { restaurantTargetSchema, suggestRestaurantSchema } from "@src/validation/restaurant";

function collectAction(collection: Collection) {
  return defineAction({
    accept: "form",
    input: restaurantTargetSchema,
    handler: async ({ restaurantId }, context) => {
      const { session } = await authorizeRestaurant(context.locals, restaurantId, "restaurant:collect");

      const result = await context.locals.db.mutations.restaurants.collect(collection, session.user.id, restaurantId);

      if (result === "refused") throw refusedSinceRequestStarted("this restaurant");
    },
  });
}

function uncollectAction(collection: Collection) {
  return defineAction({
    accept: "form",
    input: restaurantTargetSchema,
    handler: async ({ restaurantId }, context) => {
      const session = requireSession(context.locals);

      await context.locals.db.mutations.restaurants.uncollect(collection, session.user.id, restaurantId);
    },
  });
}

export const restaurantActions = {
  favorite: collectAction("favorites"),
  unfavorite: uncollectAction("favorites"),
  addToBucketList: collectAction("bucketList"),
  removeFromBucketList: uncollectAction("bucketList"),
  suggest: defineAction({
    accept: "form",
    input: suggestRestaurantSchema,
    handler: async (suggestion, context) => {
      const session = authorize(context.locals, "restaurant:suggest");

      const result = await context.locals.db.mutations.restaurants.suggest(session.user.id, suggestion);

      if (result.status === "duplicate") {
        throw new ActionError({
          code: "CONFLICT",
          message:
            result.duplicateStatus === "approved"
              ? `${suggestion.name} is already on Kebab Boxd.`
              : `${suggestion.name} is already waiting for an admin to approve it.`,
        });
      }

      return { redirect: restaurantHref(result.id) };
    },
  }),
};
