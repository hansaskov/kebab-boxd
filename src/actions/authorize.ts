import { ActionError } from "astro:actions";
import { z } from "astro/zod";
import { can, canOn, type ResourcePermission, type RestaurantPermission, type ReviewPermission, type UserPermission } from "@src/auth/permissions";
import { usernameSchema } from "@src/validation/username";

export const targetUserSchema = z.object({
  username: usernameSchema,
});

export function refusedSinceRequestStarted(resource = "this user") {
  return new ActionError({
    code: "CONFLICT",
    message: `Your role or ${resource} changed. Reload the page and try again.`,
  });
}

const refusals: Record<ResourcePermission | "restaurant:suggest", string> = {
  "user:view-profile": "You cannot see this profile.",
  "user:follow": "You cannot follow this user.",
  "user:unfollow": "You cannot unfollow this user.",
  "user:edit-settings": "You cannot change the settings of this account.",
  "user:manage-sessions": "You cannot manage the devices of this account.",
  "user:export-data": "You cannot download the data of this account.",
  "user:delete-account": "You cannot delete this account.",
  "user:ban": "You cannot ban or unban this user.",
  "user:change-role": "You cannot change the role of this user.",
  "review:view": "You cannot see this review.",
  "review:edit": "You cannot change this review.",
  "review:delete": "You cannot delete this review.",
  "review:like": "You cannot like this review.",
  "review:unlike": "You cannot unlike this review.",
  "restaurant:view": "You cannot see this restaurant.",
  "restaurant:review": "You can only review a restaurant after an admin approves it.",
  "restaurant:collect": "You can only save a restaurant after an admin approves it.",
  "restaurant:moderate": "You cannot approve or reject restaurants.",
  "restaurant:suggest": "You cannot suggest restaurants.",
};

function forbidden(permission: keyof typeof refusals) {
  return new ActionError({ code: "FORBIDDEN", message: refusals[permission] });
}

function notFound(message: string) {
  return new ActionError({ code: "NOT_FOUND", message });
}

export function requireSession(locals: App.Locals) {
  const session = locals.session;

  if (!session) {
    throw new ActionError({
      code: "UNAUTHORIZED",
      message: "You must be signed in.",
    });
  }

  return session;
}

export function authorize(locals: App.Locals, permission: "restaurant:suggest") {
  const session = requireSession(locals);

  if (!can(session.user, permission)) {
    throw forbidden(permission);
  }

  return session;
}

export async function authorizeTargetUser(locals: App.Locals, username: string, permission: UserPermission) {
  const session = requireSession(locals);
  const targetUser = await locals.db.queries.users.findByUsername(username);

  if (!targetUser) {
    throw notFound(`User "${username}" not found.`);
  }

  if (!can(session.user, permission, targetUser)) {
    throw forbidden(permission);
  }

  return { session, targetUser };
}

export async function authorizeReview(locals: App.Locals, reviewId: number, permission: ReviewPermission) {
  const session = requireSession(locals);
  const review = await locals.db.queries.reviews.findById(reviewId, session.user.id);

  if (!review || !canOn(session.user, "review:view", review)) {
    throw notFound("The review does not exist.");
  }

  if (!canOn(session.user, permission, review)) {
    throw forbidden(permission);
  }

  return { session, review };
}

export async function authorizeRestaurant(locals: App.Locals, restaurantId: number, permission: RestaurantPermission) {
  const session = requireSession(locals);
  const restaurant = await locals.db.queries.restaurants.findById(restaurantId, session.user.id);

  if (!restaurant || !canOn(session.user, "restaurant:view", restaurant)) {
    throw notFound("The restaurant does not exist.");
  }

  if (!canOn(session.user, permission, restaurant)) {
    throw forbidden(permission);
  }

  return { session, restaurant };
}
