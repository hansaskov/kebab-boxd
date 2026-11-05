import { defineAction } from "astro:actions";
import { z } from "astro/zod";
import { orThrow, requireSession, targetUserSchema } from "@src/actions/authorize";
import { roles } from "@src/db/schema";
import { adminUserHref } from "@src/hrefs";
import { citySearchSchema, citySearchTargetSchema } from "@src/validation/city-search";
import { decisionSchema } from "@src/validation/restaurant";

export const changeUserRoleSchema = targetUserSchema.extend({
  role: z.enum(roles),
});

function banAction(write: "ban" | "unban") {
  return defineAction({
    accept: "form",
    input: targetUserSchema,
    handler: async ({ username }, { locals }) => {
      const user = orThrow(await locals.db.users[write](requireSession(locals).user.id, username));
      return { redirect: adminUserHref(user.username) };
    },
  });
}

export const adminActions = {
  // The submit button sends the status, so one form can approve or reject.
  decideRestaurants: defineAction({
    accept: "form",
    input: decisionSchema,
    handler: async ({ restaurantId, status }, { locals }) => {
      return orThrow(await locals.db.restaurants.decide(requireSession(locals).user.id, restaurantId, status));
    },
  }),
  startCitySearch: defineAction({
    accept: "form",
    input: citySearchSchema,
    handler: async ({ cityId, cityName }, { locals }) => {
      orThrow(await locals.db.citySearches.start(requireSession(locals).user.id, cityId, cityName));
    },
  }),
  retryCitySearch: defineAction({
    accept: "form",
    input: citySearchTargetSchema,
    handler: async ({ citySearchId }, { locals }) => {
      orThrow(await locals.db.citySearches.retry(requireSession(locals).user.id, citySearchId));
    },
  }),
  updateCityList: defineAction({
    accept: "form",
    handler: async (_input, { locals }) => {
      orThrow(await locals.db.cities.requestUpdate(requireSession(locals).user.id));
    },
  }),
  banUser: banAction("ban"),
  unbanUser: banAction("unban"),
  changeUserRole: defineAction({
    accept: "form",
    input: changeUserRoleSchema,
    handler: async ({ username, role }, { locals }) => {
      const user = orThrow(await locals.db.users.setRole(requireSession(locals).user.id, username, role));
      return { redirect: adminUserHref(user.username) };
    },
  }),
};
