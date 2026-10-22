import { ActionError } from "astro:actions";
import { can, type UserPermission } from "@src/auth/permissions";

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
      message: "You do not have permission to change this account.",
    });
  }

  return { session, targetUser };
}
