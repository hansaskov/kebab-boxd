import { defineAction } from "astro:actions";
import { z } from "astro/zod";
import { orThrow, requireSession, targetUserSchema } from "@src/actions/authorize";
import { roles } from "@src/users/users";
import { idSchema } from "@src/actions/schemas";
import { pageSizes } from "@src/pagination";
import { adminUserHref } from "@src/hrefs";

export const maxDecidedAtOnce = Math.max(...pageSizes);

export const decisionSchema = z.object({
  restaurantId: z.array(idSchema).min(1, "Choose at least one restaurant.").max(maxDecidedAtOnce),
  status: z.enum(["approved", "rejected"]),
});

export const citySearchSchema = z.object({
  cityId: idSchema,
  cityName: z.string().trim().min(1).max(200),
});

export const citySearchTargetSchema = z.object({
  citySearchId: idSchema,
});

export const changeUserRoleSchema = targetUserSchema.extend({
  role: z.enum(roles),
});

function banAction(write: "ban" | "unban") {
  return defineAction({
    accept: "form",
    input: targetUserSchema,
    handler: async ({ username }, { locals }) => {
      const { db } = locals;
      const { user: actor } = await requireSession(locals);
      const user = orThrow(await db.load(db.users[write](actor.id, username)));
      return { redirect: adminUserHref(user.username) };
    },
  });
}

export const adminActions = {
  decideRestaurants: defineAction({
    accept: "form",
    input: decisionSchema,
    handler: async ({ restaurantId, status }, { locals }) => {
      const { db } = locals;
      const { user: actor } = await requireSession(locals);
      return orThrow(await db.load(db.restaurants.decide(actor.id, restaurantId, status)));
    },
  }),
  startCitySearch: defineAction({
    accept: "form",
    input: citySearchSchema,
    handler: async ({ cityId, cityName }, { locals }) => {
      const { db } = locals;
      const { user: actor } = await requireSession(locals);
      orThrow(await db.load(db.citySearches.start(actor.id, cityId, cityName)));
    },
  }),
  retryCitySearch: defineAction({
    accept: "form",
    input: citySearchTargetSchema,
    handler: async ({ citySearchId }, { locals }) => {
      const { db } = locals;
      const { user: actor } = await requireSession(locals);
      orThrow(await db.load(db.citySearches.retry(actor.id, citySearchId)));
    },
  }),
  updateCityList: defineAction({
    accept: "form",
    handler: async (_input, { locals }) => {
      const { db } = locals;
      const { user: actor } = await requireSession(locals);
      orThrow(await db.load(db.cities.requestUpdate(actor.id)));
    },
  }),
  banUser: banAction("ban"),
  unbanUser: banAction("unban"),
  changeUserRole: defineAction({
    accept: "form",
    input: changeUserRoleSchema,
    handler: async ({ username, role }, { locals }) => {
      const { db } = locals;
      const { user: actor } = await requireSession(locals);
      const user = orThrow(await db.load(db.users.setRole(actor.id, username, role)));
      return { redirect: adminUserHref(user.username) };
    },
  }),
};
