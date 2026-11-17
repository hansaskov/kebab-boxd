import { defineAction } from "astro:actions";
import { requireSession } from "@src/actions/authorize";
import { landingHref } from "@src/hrefs";

export const sessionActions = {
  toggleTheme: defineAction({
    accept: "form",
    handler: async (_, { locals }) => {
      const { db } = locals;
      const session = await requireSession(locals);
      await db.load(db.sessions.setTheme(session.id, session.theme === "dark" ? "light" : "dark"));
    },
  }),
  signOut: defineAction({
    accept: "form",
    handler: async (_, { locals }) => {
      const { db } = locals;
      const session = await requireSession(locals);
      await db.load(db.sessions.delete(session.id));
      return { redirect: landingHref };
    },
  }),
};
