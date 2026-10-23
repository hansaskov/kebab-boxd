import { ActionError } from "astro:actions";
import { z } from "astro/zod";
import { can, type UserPermission } from "@src/auth/permissions";
import { usernameSchema } from "@src/validation/username";

export const targetUserSchema = z.object({
  username: usernameSchema,
});

export function refusedSinceRequestStarted() {
  return new ActionError({
    code: "CONFLICT",
    message: "Your role or this user changed. Reload the page and try again.",
  });
}

const refusals: Record<UserPermission, string> = {
  "user:view-profile": "You cannot see this profile.",
  "user:follow": "You cannot follow this user.",
  "user:unfollow": "You cannot unfollow this user.",
  "user:edit-settings": "You cannot change the settings of this account.",
  "user:manage-sessions": "You cannot manage the devices of this account.",
  "user:export-data": "You cannot download the data of this account.",
  "user:delete-account": "You cannot delete this account.",
  "user:ban": "You cannot ban or unban this user.",
  "user:change-role": "You cannot change the role of this user.",
};

export async function authorizeTargetUser(locals: App.Locals, username: string, permission: UserPermission) {
  const session = locals.session;

  if (!session) {
    throw new ActionError({
      code: "UNAUTHORIZED",
      message: "You must be signed in.",
    });
  }

  const targetUser = await locals.db.queries.users.findByUsername(username);

  if (!targetUser) {
    throw new ActionError({
      code: "NOT_FOUND",
      message: `User "${username}" not found.`,
    });
  }

  if (!can(session.user, permission, targetUser)) {
    throw new ActionError({
      code: "FORBIDDEN",
      message: refusals[permission],
    });
  }

  return { session, targetUser };
}
