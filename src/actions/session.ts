import { defineAction } from "astro:actions";
import { requireSession } from "@src/actions/authorize";
import { deleteSessionTokenCookie } from "@src/auth/session";

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
    handler: async (_, { locals, cookies }) => {
      await locals.db.sessions.delete(requireSession(locals).id);
      deleteSessionTokenCookie(cookies);
      return { redirect: "/login" };
    },
  }),
};
