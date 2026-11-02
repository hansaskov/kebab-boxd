import { defineAction } from "astro:actions";
import { z } from "astro/zod";
import { requireSession } from "@src/actions/authorize";
import { idSchema } from "@src/validation/id";

export const markAllReadSchema = z.object({
  upToId: idSchema,
});

export const notificationActions = {
  // Needs no permission: a user can only ever mark their own notifications.
  markAllRead: defineAction({
    accept: "form",
    input: markAllReadSchema,
    handler: async ({ upToId }, context) => {
      const session = requireSession(context.locals);

      await context.locals.db.notifications.markAllRead(session.user.id, upToId);
    },
  }),
};
