import { and, eq, isNotNull, isNull, ne, sql } from "drizzle-orm";
import { can, type UserPermission } from "@src/auth/permissions";
import type { Client } from "@src/db/client";
import { prepareRefreshLikeCounts, prepareRefreshRestaurantStats } from "@src/db/mutations/cached-stats";
import { prepareDeleteAllForUser } from "@src/db/mutations/sessions";
import * as s from "@src/db/schema";
import type { Role, User } from "@src/db/schema";
import { getSQLiteError, isUniqueConstraintError } from "@src/db/sqlite-errors";

export type Profile = Pick<User, "fullname" | "username" | "pronoun" | "bio">;

function idList(rows: { id: number | null }[]) {
	return JSON.stringify(rows.map((row) => row.id));
}

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

	const reviewedRestaurantIds = client
		.selectDistinct({ id: s.reviews.restaurantId })
		.from(s.reviews)
		.where(eq(s.reviews.authorId, sql.placeholder("id")))
		.prepare();

	const reviewIdsLikedFromOthers = client
		.select({ id: s.likes.reviewId })
		.from(s.likes)
		.innerJoin(s.reviews, eq(s.reviews.id, s.likes.reviewId))
		.where(and(eq(s.likes.userId, sql.placeholder("id")), ne(s.reviews.authorId, sql.placeholder("id"))))
		.prepare();

	const profilePictureId = client
		.select({ id: s.users.profilePictureId })
		.from(s.users)
		.where(and(eq(s.users.id, sql.placeholder("id")), isNotNull(s.users.profilePictureId)))
		.prepare();

	const reviewPictureIds = client
		.select({ id: s.reviewPictures.pictureId })
		.from(s.reviewPictures)
		.innerJoin(s.reviews, eq(s.reviews.id, s.reviewPictures.reviewId))
		.where(eq(s.reviews.authorId, sql.placeholder("id")))
		.prepare();

	const clearSuggestedBy = client
		.update(s.restaurants)
		.set({ suggestedBy: null })
		.where(eq(s.restaurants.suggestedBy, sql.placeholder("id")))
		.prepare();

	const deleteUser = client
		.delete(s.users)
		.where(eq(s.users.id, sql.placeholder("id")))
		.prepare();

	const deletePictures = client
		.delete(s.pictures)
		.where(sql`${s.pictures.id} in (select value from json_each(${sql.placeholder("pictureIds")}))`)
		.prepare();

	const refreshLikeCounts = prepareRefreshLikeCounts(client);
	const refreshRestaurantStats = prepareRefreshRestaurantStats(client);

	const authorizationAttributes = client
		.select({ id: s.users.id, role: s.users.role, bannedAt: s.users.bannedAt })
		.from(s.users)
		.where(eq(s.users.id, sql.placeholder("id")))
		.prepare();

	function writeIfAuthorized(actorId: number, id: number, permission: UserPermission, write: () => void) {
		return client.transaction(
			(): "updated" | "refused" => {
				const actor = authorizationAttributes.get({ id: actorId });
				const target = authorizationAttributes.get({ id });
				if (!actor || !target || !can(actor, permission, target)) {
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

		async setRole(id: number, role: Role, actorId: number) {
			return writeIfAuthorized(actorId, id, "user:change-role", () => {
				setRole.run({ id, role });
			});
		},

		async ban(id: number, actorId: number) {
			return writeIfAuthorized(actorId, id, "user:ban", () => {
				setBannedAt.run({ id, bannedAt: new Date() });
				deleteSessions.run({ userId: id });
			});
		},

		async unban(id: number, actorId: number) {
			return writeIfAuthorized(actorId, id, "user:ban", () => {
				clearBannedAt.run({ id });
			});
		},

		async delete(id: number, actorId: number) {
			return writeIfAuthorized(actorId, id, "user:delete-account", () => {
				const restaurantIds = idList(reviewedRestaurantIds.all({ id }));
				const reviewIds = idList(reviewIdsLikedFromOthers.all({ id }));
				const pictureIds = idList([...profilePictureId.all({ id }), ...reviewPictureIds.all({ id })]);

				clearSuggestedBy.run({ id });
				deleteUser.run({ id });
				deletePictures.run({ pictureIds });
				refreshLikeCounts.run({ reviewIds });
				refreshRestaurantStats.run({ restaurantIds });
			});
		},
	};
}
