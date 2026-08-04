import { ActionError, defineAction } from "astro:actions";
import { z } from "astro/zod";
import { eq } from "drizzle-orm";
import { pronouns } from "@src/data/pronouns";
import { s } from "@src/db";
import { isUniqueConstraintError } from "@src/db/sqlite-errors";

export const updateSettingsInput = z.object({
	currentUsername: z.string().trim().min(1, "The current username is required."),
	fullname: z
		.string()
		.trim()
		.min(3)
		.max(30),	
	username: z
		.string()
		.trim()
		.min(3)
		.max(30),
	pronoun: z.enum(pronouns).nullable(),
	bio: z
		.string()
		.trim()
		.max(500)
		.nullable(),
});

export const server = {
	updateSettings: defineAction({
		accept: "form",
		input: updateSettingsInput,
		handler: async (input, context) => {

			const session = context.locals.session;

			if (!session) {
				throw new ActionError({ code: "UNAUTHORIZED", message: "You must be signed in." });
			}

			const targetUser = await context.locals.db.query.users.findFirst({
				where: { username: { eq: input.currentUsername } },
			});

			if (!targetUser) {
				throw new ActionError({ code: "NOT_FOUND", message: `User "${input.currentUsername}" not found.` });
			}

			if (session.user.isAdmin !== false && session.user.id !== targetUser.id) {
				throw new ActionError({
					code: "FORBIDDEN",
					message: "You are not allowed to change this profile.",
				});
			}

			try {
				await context.locals.db
					.update(s.users)
					.set({
						fullname: input.fullname,
						username: input.username,
						pronoun: input.pronoun,
						bio: input.bio,
					})
					.where(eq(s.users.id, targetUser.id)).returning();
			} catch (error) {
				if (isUniqueConstraintError(error)) {
					throw new ActionError({ code: "CONFLICT", message: "Username is already taken." });
				}

				throw error;
			}

			// Redirect to the settings page of the (possibly new) username.
			return { redirect: `/${encodeURIComponent(input.username)}/settings` };
		},
	}),
};
