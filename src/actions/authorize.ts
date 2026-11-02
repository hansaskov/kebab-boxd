import { ActionError } from "astro:actions";
import { z } from "astro/zod";
import { can, resourceOf, type ResourceName, type ResourcePermission, type Subject } from "@src/auth/permissions";
import { isProblem, type Problem } from "@src/db/problem";
import { maxQueuedPerUser } from "@src/db/suggestion-queue";
import { maxPicturesPerReview } from "@src/validation/review";
import { usernameSchema } from "@src/validation/username";

type ErrorCode = ConstructorParameters<typeof ActionError>[0]["code"];

export const targetUserSchema = z.object({
  username: usernameSchema,
});

const forbidden: Record<ResourcePermission | "restaurant:suggest", string> = {
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

const notFound: Record<ResourceName, string> = {
  user: "The user does not exist.",
  review: "The review does not exist.",
  restaurant: "The restaurant does not exist.",
};

const problems: Record<Exclude<Problem["problem"], "not-found" | "forbidden">, [ErrorCode, string]> = {
  "invalid-picture": ["BAD_REQUEST", "A file is not a picture. Use JPEG, PNG, WebP, AVIF or GIF."],
  "too-many-pictures": ["BAD_REQUEST", `A review can have at most ${maxPicturesPerReview} pictures.`],
  "username-taken": ["CONFLICT", "Username is already taken."],
  "queue-full": ["TOO_MANY_REQUESTS", `You have ${maxQueuedPerUser} links waiting. Suggest more when they are done.`],
  "account-gone": ["UNAUTHORIZED", "Your account no longer exists."],
};

function toActionError(result: Problem) {
  if ("permission" in result) {
    return result.problem === "not-found"
      ? new ActionError({ code: "NOT_FOUND", message: notFound[resourceOf(result.permission)] })
      : new ActionError({ code: "FORBIDDEN", message: forbidden[result.permission] });
  }
  const [code, message] = problems[result.problem];
  return new ActionError({ code, message });
}

// The result of a write, or the error that tells the user why it did not happen.
export function orThrow<T>(result: T): Exclude<T, Problem> {
  if (isProblem(result)) throw toActionError(result);
  return result as Exclude<T, Problem>;
}

export function requireSession(locals: App.Locals) {
  if (!locals.session) {
    throw new ActionError({ code: "UNAUTHORIZED", message: "You must be signed in." });
  }
  return locals.session;
}

// Only for a permission on no resource. A permission on one is checked by the write, in its transaction.
export function requirePermission(subject: Subject, permission: "restaurant:suggest") {
  if (!can(subject, permission)) throw new ActionError({ code: "FORBIDDEN", message: forbidden[permission] });
}
