import { and, eq, isNull, sql } from "drizzle-orm";
import type { Subject, TargetUser } from "@src/auth/permissions";
import type { Client } from "@src/db/client";
import { prepareDeleteAllForUser } from "@src/db/mutations/sessions";
import * as s from "@src/db/schema";
import type { Role, User } from "@src/db/schema";
import { getSQLiteError, isUniqueConstraintError } from "@src/db/sqlite-errors";

export type Profile = Pick<User, "fullname" | "username" | "pronoun" | "bio">;

/** Decides whether the acting user may change the target, from both as they are when the change is written. */
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

	// A user who is banned again keeps the time of the first ban.
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

	/**
	 * Runs `write` if `authorize` allows it, from the acting user and the target read again in the
	 * same transaction. The users read when the request started may be out of date, and two Admins
	 * who demote each other at the same time must not leave the site without an Admin.
	 *
	 * The callback must stay synchronous: the driver commits as soon as it returns. The prepared
	 * statements run on the same connection, so they take part in the transaction, and an error
	 * rolls all of them back. "immediate" takes the write lock before the first read, so the
	 * transaction cannot fail with SQLITE_BUSY part way when another connection writes to the file.
	 */
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

		/** Gives the user the role, if `authorize` lets `actorId` do it. */
		async setRole(id: number, role: Role, actorId: number, authorize: Authorize) {
			return writeIfAuthorized(actorId, id, authorize, () => {
				setRole.run({ id, role });
			});
		},

		/** Bans the user and signs them out on every device, if `authorize` lets `actorId` do it. */
		async ban(id: number, actorId: number, authorize: Authorize) {
			return writeIfAuthorized(actorId, id, authorize, () => {
				setBannedAt.run({ id, bannedAt: new Date() });
				deleteSessions.run({ userId: id });
			});
		},

		/** Lifts the ban, if `authorize` lets `actorId` do it. */
		async unban(id: number, actorId: number, authorize: Authorize) {
			return writeIfAuthorized(actorId, id, authorize, () => {
				clearBannedAt.run({ id });
			});
		},
	};
}
