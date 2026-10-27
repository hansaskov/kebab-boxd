import { defineAction } from "astro:actions";
import { z } from "astro/zod";
import { orThrow, requireSession, targetUserSchema } from "@src/actions/authorize";
import { roles } from "@src/db/schema";
import { adminUserHref } from "@src/hrefs";
import { restaurantTargetSchema } from "@src/validation/restaurant";

export const changeUserRoleSchema = targetUserSchema.extend({
  role: z.enum(roles),
});

function decideSuggestionAction(status: "approved" | "rejected") {
  return defineAction({
    accept: "form",
    input: restaurantTargetSchema,
    handler: async ({ restaurantId }, { locals }) => {
      orThrow(await locals.db.mutations.restaurants.setStatus(requireSession(locals).user.id, restaurantId, status));
    },
  });
}

function banAction(write: "ban" | "unban") {
  return defineAction({
    accept: "form",
    input: targetUserSchema,
    handler: async ({ username }, { locals }) => {
      const user = orThrow(await locals.db.mutations.users[write](requireSession(locals).user.id, username));
      return { redirect: adminUserHref(user.username) };
    },
  });
}

export const adminActions = {
  approveRestaurant: decideSuggestionAction("approved"),
  rejectRestaurant: decideSuggestionAction("rejected"),
  banUser: banAction("ban"),
  unbanUser: banAction("unban"),
  changeUserRole: defineAction({
    accept: "form",
    input: changeUserRoleSchema,
    handler: async ({ username, role }, { locals }) => {
      const user = orThrow(await locals.db.mutations.users.setRole(requireSession(locals).user.id, username, role));
      return { redirect: adminUserHref(user.username) };
    },
  }),
};
