import { defineAction } from "astro:actions";
import { orThrow, requireSession, targetUserSchema } from "@src/actions/authorize";
import type { Database } from "@src/db";

function followAction(write: keyof Pick<Database["follows"], "follow" | "unfollow" | "approveRequest" | "removeFollower">) {
  return defineAction({
    accept: "form",
    input: targetUserSchema,
    handler: async ({ username }, { locals }) => {
      const { db } = locals;
      const { user: actor } = await requireSession(locals);
      orThrow(await db.load(db.follows[write](actor.id, username)));
    },
  });
}

export const profileActions = {
  follow: followAction("follow"),
  unfollow: followAction("unfollow"),
  approveFollowRequest: followAction("approveRequest"),
  removeFollower: followAction("removeFollower"),
};
