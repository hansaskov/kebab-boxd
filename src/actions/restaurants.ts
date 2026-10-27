import { ActionError, defineAction } from "astro:actions";
import { authorize, authorizeRestaurant, refusedSinceRequestStarted, requireSession } from "@src/actions/authorize";
import type { Collection } from "@src/db/mutations/restaurants";
import { maxQueuedPerUser } from "@src/db/mutations/suggestion-queue";
import { restaurantTargetSchema, suggestionSchema } from "@src/validation/restaurant";

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
    input: suggestionSchema,
    handler: async ({ link }, context) => {
      const session = authorize(context.locals, "restaurant:suggest");

      const result = await context.locals.db.mutations.suggestionQueue.queue(session.user.id, link);

      if (result.status === "gone") {
        throw new ActionError({ code: "UNAUTHORIZED", message: "Your account no longer exists." });
      }
      if (result.status === "full") {
        throw new ActionError({
          code: "TOO_MANY_REQUESTS",
          message: `You have ${maxQueuedPerUser} links waiting. Suggest more when they are done.`,
        });
      }
    },
  }),
};
