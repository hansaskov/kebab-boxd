import { and, eq, isNull, sql } from "drizzle-orm";
import type { Subject, TargetUser } from "@src/auth/permissions";
import type { Client } from "@src/db/client";
import { prepareDeleteAllForUser } from "@src/db/mutations/sessions";
import * as s from "@src/db/schema";
import type { Role, User } from "@src/db/schema";
import { getSQLiteError, isUniqueConstraintError } from "@src/db/sqlite-errors";

export type Profile = Pick<User, "fullname" | "username" | "pronoun" | "bio">;

export type Authorize = (actor: Subject, target: TargetUser) => boolean;

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

	const setRole = client
		.update(s.users)
		.set({ role: sql.placeholder("role") })
		.where(eq(s.users.id, sql.placeholder("id")))
		.prepare();

	const setBannedAt = client
		.update(s.users)
		.set({ bannedAt: sql.placeholder("bannedAt") })
		.where(and(eq(s.users.id, sql.placeholder("id")), isNull(s.users.bannedAt)))
		.prepare();

	const clearBannedAt = client
		.update(s.users)
		.set({ bannedAt: null })
		.where(eq(s.users.id, sql.placeholder("id")))
		.prepare();

	const deleteSessions = prepareDeleteAllForUser(client);

	const authorizationAttributes = client
		.select({ id: s.users.id, role: s.users.role, bannedAt: s.users.bannedAt })
		.from(s.users)
		.where(eq(s.users.id, sql.placeholder("id")))
		.prepare();

	function writeIfAuthorized(actorId: number, id: number, authorize: Authorize, write: () => void) {
		return client.transaction(
			(): "updated" | "refused" => {
				const actor = authorizationAttributes.get({ id: actorId });
				const target = authorizationAttributes.get({ id });
				if (!actor || !target || !authorize(actor, target)) {
					return "refused";
				}
				write();
				return "updated";
			},
			{ behavior: "immediate" },
		);
	}

	return {

		async updateProfile(id: number, profile: Profile): Promise<"updated" | "username-taken"> {
			try {
				updateProfile.run({ id, ...profile });
				return "updated";
			} catch (error) {
				if (isUniqueConstraintError(getSQLiteError(error))) {
					return "username-taken";
				}
				throw error;
			}
		},

		async verifyEmail(id: number) {
			verifyEmail.run({ id });
		},

		async setRole(id: number, role: Role, actorId: number, authorize: Authorize) {
			return writeIfAuthorized(actorId, id, authorize, () => {
				setRole.run({ id, role });
			});
		},

		async ban(id: number, actorId: number, authorize: Authorize) {
			return writeIfAuthorized(actorId, id, authorize, () => {
				setBannedAt.run({ id, bannedAt: new Date() });
				deleteSessions.run({ userId: id });
			});
		},

		async unban(id: number, actorId: number, authorize: Authorize) {
			return writeIfAuthorized(actorId, id, authorize, () => {
				clearBannedAt.run({ id });
			});
		},
	};
}
