import { defineAction } from "astro:actions";
import { z } from "astro/zod";
import { authorizeRestaurant, authorizeTargetUser, refusedSinceRequestStarted, targetUserSchema } from "@src/actions/authorize";
import { roles } from "@src/db/schema";
import { adminUserHref } from "@src/hrefs";
import { restaurantTargetSchema } from "@src/validation/restaurant";

export const changeUserRoleSchema = targetUserSchema.extend({
  role: z.enum(roles),
});

function decideSuggestionAction(status: "approved" | "rejected") {
  return defineAction({
    accept: "form",
    input: restaurantTargetSchema,
    handler: async ({ restaurantId }, context) => {
      const { session } = await authorizeRestaurant(context.locals, restaurantId, "restaurant:moderate");

      const result = await context.locals.db.mutations.restaurants.setStatus(session.user.id, restaurantId, status);

      if (result === "refused") {
        throw refusedSinceRequestStarted("this restaurant");
      }
    },
  });
}

export const adminActions = {
  approveRestaurant: decideSuggestionAction("approved"),
  rejectRestaurant: decideSuggestionAction("rejected"),
  banUser: defineAction({
    accept: "form",
    input: targetUserSchema,
    handler: async (input, context) => {
      const { session, targetUser } = await authorizeTargetUser(context.locals, input.username, "user:ban");

      const result = await context.locals.db.mutations.users.ban(targetUser.id, session.user.id);

      if (result === "refused") {
        throw refusedSinceRequestStarted();
      }

      return { redirect: adminUserHref(targetUser.username) };
    },
  }),
  unbanUser: defineAction({
    accept: "form",
    input: targetUserSchema,
    handler: async (input, context) => {
      const { session, targetUser } = await authorizeTargetUser(context.locals, input.username, "user:ban");

      const result = await context.locals.db.mutations.users.unban(targetUser.id, session.user.id);

      if (result === "refused") {
        throw refusedSinceRequestStarted();
      }

      return { redirect: adminUserHref(targetUser.username) };
    },
  }),
  changeUserRole: defineAction({
    accept: "form",
    input: changeUserRoleSchema,
    handler: async (input, context) => {
      const { session, targetUser } = await authorizeTargetUser(
        context.locals,
        input.username,
        "user:change-role",
      );

      const result = await context.locals.db.mutations.users.setRole(targetUser.id, input.role, session.user.id);

      if (result === "refused") {
        throw refusedSinceRequestStarted();
      }

      return { redirect: adminUserHref(targetUser.username) };
    },
  }),
};
