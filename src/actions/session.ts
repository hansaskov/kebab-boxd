import { defineAction } from "astro:actions";
import { requireSession } from "@src/actions/authorize";

export const sessionActions = {
  toggleTheme: defineAction({
    accept: "form",
    handler: async (_, { locals }) => {
      const session = requireSession(locals);
      await locals.db.sessions.setTheme(session.id, session.theme === "dark" ? "light" : "dark");
    },
  }),
  signOut: defineAction({
    accept: "form",
    handler: async (_, { locals }) => {
      await locals.db.sessions.delete(requireSession(locals).id);
      return { redirect: "/login" };
    },
  }),
};
