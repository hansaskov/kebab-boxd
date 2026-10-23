import { defineAction } from "astro:actions";
import { authorizeTargetUser, refusedSinceRequestStarted, targetUserSchema } from "@src/actions/authorize";

export const profileActions = {
  follow: defineAction({
    accept: "form",
    input: targetUserSchema,
    handler: async (input, context) => {
      const { session, targetUser } = await authorizeTargetUser(context.locals, input.username, "user:follow");

      const result = await context.locals.db.mutations.follows.follow(session.user.id, targetUser.id);

      if (result === "refused") {
        throw refusedSinceRequestStarted();
      }
    },
  }),
  unfollow: defineAction({
    accept: "form",
    input: targetUserSchema,
    handler: async (input, context) => {
      const { session, targetUser } = await authorizeTargetUser(context.locals, input.username, "user:unfollow");

      const result = await context.locals.db.mutations.follows.unfollow(session.user.id, targetUser.id);

      if (result === "refused") {
        throw refusedSinceRequestStarted();
      }
    },
  }),
};
