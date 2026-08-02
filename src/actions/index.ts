import { ActionError, defineAction } from "astro:actions";
import type { ActionAPIContext } from "astro:actions";
import { z } from "astro/zod";
import { eq } from "drizzle-orm";
import { getSessionAndUserFromCookie } from "@src/auth/session";
import { s } from "@src/db";
import { pronouns } from "@src/data/pronouns";

const fullnameSchema = z.object({
	fullname: z
		.string()
		.trim()
		.min(1, "Full name is required.")
		.max(100, "Full name must be 100 characters or fewer."),
});

const usernameSchema = z.object({
	username: z
		.string()
		.trim()
		.min(2, "Username must be at least 2 characters long.")
		.max(32, "Username must be 32 characters or fewer.")
		.regex(
			/^[a-zA-Z0-9_.-]+$/,
			"Username may only contain letters, numbers, periods, underscores and hyphens.",
		),
});

const bioSchema = z.object({
	bio: z.string().trim().max(500, "Bio must be 500 characters or fewer."),
});

const pronounsSchema = z.object({
	pronoun: z.union([z.enum(pronouns), z.literal("")]),
});

/**
 * Resolve the profile that is being edited and verify that the signed-in
 * user is allowed to edit it. Mirrors the authorization rules of the
 * settings page: the profile owner or an admin.
 */
async function getAuthorizedTargetUser(context: ActionAPIContext) {
	const session = await getSessionAndUserFromCookie(context.cookies, context.locals.db);

	if (!session) {
		throw new ActionError({ code: "UNAUTHORIZED", message: "You must be signed in." });
	}

	const username = context.params.username;

	if (!username) {
		throw new ActionError({ code: "NOT_FOUND", message: "User not found." });
	}

	const targetUser = await context.locals.db.query.users.findFirst({
		where: { username: { eq: username } },
	});

	if (!targetUser) {
		throw new ActionError({ code: "NOT_FOUND", message: "User not found." });
	}

	if (session.user.isAdmin === false && session.user.id !== targetUser.id) {
		throw new ActionError({ code: "FORBIDDEN", message: "You are not allowed to change this profile." });
	}

	return { session, targetUser };
}

export const server = {
	updateFullname: defineAction({
		accept: "form",
		input: fullnameSchema,
		handler: async (input, context) => {
			const { targetUser } = await getAuthorizedTargetUser(context);

			await context.locals.db
				.update(s.users)
				.set({ fullname: input.fullname })
				.where(eq(s.users.id, targetUser.id));
		},
	}),
	updateUsername: defineAction({
		accept: "form",
		input: usernameSchema,
		handler: async (input, context) => {
			const { targetUser } = await getAuthorizedTargetUser(context);

			const existing = await context.locals.db.query.users.findFirst({
				where: { username: { eq: input.username }, id: { ne: targetUser.id } },
			});

			if (existing) {
				throw new ActionError({ code: "CONFLICT", message: "That username is already taken." });
			}

			await context.locals.db
				.update(s.users)
				.set({ username: input.username })
				.where(eq(s.users.id, targetUser.id));

			return { username: input.username };
		},
	}),
	updateBio: defineAction({
		accept: "form",
		input: bioSchema,
		handler: async (input, context) => {
			const { targetUser } = await getAuthorizedTargetUser(context);

			await context.locals.db
				.update(s.users)
				.set({ bio: input.bio === "" ? null : input.bio })
				.where(eq(s.users.id, targetUser.id));
		},
	}),
	updatePronouns: defineAction({
		accept: "form",
		input: pronounsSchema,
		handler: async (input, context) => {
			const { targetUser } = await getAuthorizedTargetUser(context);

			await context.locals.db
				.update(s.users)
				.set({ pronoun: input.pronoun === "" ? null : input.pronoun })
				.where(eq(s.users.id, targetUser.id));
		},
	}),
};
