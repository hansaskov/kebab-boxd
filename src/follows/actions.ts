import { defineAction } from "astro:actions";
import { orThrow, requireSession, targetUserSchema } from "@src/actions/authorize";
import type { Database } from "@src/db";

// Each changes the Follow between the signed-in User and the user the form names.
function followAction(write: keyof Pick<Database["follows"], "follow" | "unfollow" | "approveRequest" | "removeFollower">) {
  return defineAction({
    accept: "form",
    input: targetUserSchema,
    handler: async ({ username }, { locals }) => {
      orThrow(await locals.db.follows[write](requireSession(locals).user.id, username));
    },
  });
}

export const profileActions = {
  follow: followAction("follow"),
  unfollow: followAction("unfollow"),
  approveFollowRequest: followAction("approveRequest"),
  removeFollower: followAction("removeFollower"),
};
