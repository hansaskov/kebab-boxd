import { defineAction } from "astro:actions";
import { orThrow, requireSession, targetUserSchema } from "@src/actions/authorize";

function followAction(write: "follow" | "unfollow") {
  return defineAction({
    accept: "form",
    input: targetUserSchema,
    handler: async ({ username }, { locals }) => {
      orThrow(await locals.db.mutations.follows[write](requireSession(locals).user.id, username));
    },
  });
}

export const profileActions = {
  follow: followAction("follow"),
  unfollow: followAction("unfollow"),
};
