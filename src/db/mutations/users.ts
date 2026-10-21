import { eq, sql } from "drizzle-orm";
import type { Client } from "@src/db/client";
import * as s from "@src/db/schema";
import type { User } from "@src/db/schema";
import { getSQLiteError, isUniqueConstraintError } from "@src/db/sqlite-errors";

export type Profile = Pick<User, "fullname" | "username" | "pronoun" | "bio">;

export function createUserMutations(client: Client) {
	const updateProfile = client
		.update(s.users)
		.set({
			fullname: sql.placeholder("fullname"),
			username: sql.placeholder("username"),
			pronoun: sql.placeholder("pronoun"),
			bio: sql.placeholder("bio"),
		})
		.where(eq(s.users.id, sql.placeholder("id")))
		.prepare();

	const verifyEmail = client
		.update(s.users)
		.set({ emailVerified: true })
		.where(eq(s.users.id, sql.placeholder("id")))
		.prepare();

	return {
		
		async updateProfile(id: number, profile: Profile): Promise<"updated" | "username-taken"> {
			try {
				updateProfile.run({ id, ...profile });
				return "updated";
			} catch (error) {
				// The username is the only unique column the update changes.
				if (isUniqueConstraintError(getSQLiteError(error))) {
					return "username-taken";
				}
				throw error;
			}
		},

		async verifyEmail(id: number) {
			verifyEmail.run({ id });
		},
	};
}
