import { ActionError, defineAction } from "astro:actions";
import { z } from "astro/zod";
import { authorizeTargetUser } from "@src/actions/authorize";
import { can } from "@src/auth/permissions";
import { roles } from "@src/db/schema";
import { usernameSchema } from "@src/validation/username";

export const targetUserSchema = z.object({
  username: usernameSchema,
});

export const changeUserRoleSchema = targetUserSchema.extend({
  role: z.enum(roles),
});

function refusedSinceRequestStarted() {
  return new ActionError({
    code: "CONFLICT",
    message: "Your role or this user changed. Reload the page and try again.",
  });
}

export function adminUserHref(username: string) {
  return `/admin/users/${encodeURIComponent(username)}`;
}

export const adminActions = {
  banUser: defineAction({
    accept: "form",
    input: targetUserSchema,
    handler: async (input, context) => {
      const { session, targetUser } = await authorizeTargetUser(context.locals, input.username, "user:ban");

      const result = await context.locals.db.mutations.users.ban(targetUser.id, session.user.id, (actor, target) =>
        can(actor, "user:ban", target),
      );

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

      const result = await context.locals.db.mutations.users.unban(targetUser.id, session.user.id, (actor, target) =>
        can(actor, "user:ban", target),
      );

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

      const result = await context.locals.db.mutations.users.setRole(
        targetUser.id,
        input.role,
        session.user.id,
        (actor, target) => can(actor, "user:change-role", target),
      );

      if (result === "refused") {
        throw refusedSinceRequestStarted();
      }

      return { redirect: adminUserHref(targetUser.username) };
    },
  }),
};
