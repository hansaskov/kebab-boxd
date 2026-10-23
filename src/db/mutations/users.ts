import { and, eq, inArray, isNull } from "drizzle-orm";
import type { Client, Transaction } from "@src/db/client";
import { writeIfAuthorized } from "@src/db/mutations/authorized-write";
import { refreshLikeCounts, refreshRestaurantStats } from "@src/db/mutations/cached-stats";
import { deleteAllSessionsOf } from "@src/db/mutations/sessions";
import * as s from "@src/db/schema";
import type { Role, User } from "@src/db/schema";
import { getSQLiteError, isUniqueConstraintError } from "@src/db/sqlite-errors";

export type Profile = Pick<User, "fullname" | "username" | "pronoun" | "bio">;

function findDependentsOf(tx: Transaction, id: number) {
	const user = tx.query.users
		.findFirst({
			columns: { profilePictureId: true },
			with: {
				reviews: {
					columns: { restaurantId: true },
					with: { pictures: { columns: { id: true } } },
				},
				likes: { columns: { reviewId: true } },
			},
			where: { id },
		})
		.sync();
	if (!user) throw new Error(`User ${id} does not exist.`);

	const reviewPictureIds = user.reviews.flatMap((review) => review.pictures.map((picture) => picture.id));
	return {
		restaurantIds: user.reviews.map((review) => review.restaurantId),
		likedReviewIds: user.likes.map((like) => like.reviewId),
		pictureIds: user.profilePictureId === null ? reviewPictureIds : [user.profilePictureId, ...reviewPictureIds],
	};
}

export function createUserMutations(client: Client) {
	return {
		async updateProfile(id: number, profile: Profile): Promise<"updated" | "username-taken"> {
			try {
				await client.update(s.users).set(profile).where(eq(s.users.id, id));
				return "updated";
			} catch (error) {
				if (isUniqueConstraintError(getSQLiteError(error))) {
					return "username-taken";
				}
				throw error;
			}
		},

		async verifyEmail(id: number) {
			await client.update(s.users).set({ emailVerified: true }).where(eq(s.users.id, id));
		},

		async setRole(id: number, role: Role, actorId: number) {
			return writeIfAuthorized(client, actorId, id, "user:change-role", (tx) => {
				tx.update(s.users).set({ role }).where(eq(s.users.id, id)).run();
			});
		},

		async ban(id: number, actorId: number) {
			return writeIfAuthorized(client, actorId, id, "user:ban", (tx) => {
				tx.update(s.users)
					.set({ bannedAt: new Date() })
					.where(and(eq(s.users.id, id), isNull(s.users.bannedAt)))
					.run();
				deleteAllSessionsOf(tx, id);
			});
		},

		async unban(id: number, actorId: number) {
			return writeIfAuthorized(client, actorId, id, "user:ban", (tx) => {
				tx.update(s.users).set({ bannedAt: null }).where(eq(s.users.id, id)).run();
			});
		},

		async delete(id: number, actorId: number) {
			return writeIfAuthorized(client, actorId, id, "user:delete-account", (tx) => {
				const { restaurantIds, likedReviewIds, pictureIds } = findDependentsOf(tx, id);

				tx.update(s.restaurants).set({ suggestedBy: null }).where(eq(s.restaurants.suggestedBy, id)).run();
				tx.delete(s.users).where(eq(s.users.id, id)).run();
				tx.delete(s.pictures).where(inArray(s.pictures.id, pictureIds)).run();
				refreshLikeCounts(tx, likedReviewIds);
				refreshRestaurantStats(tx, restaurantIds);
			});
		},
	};
}
