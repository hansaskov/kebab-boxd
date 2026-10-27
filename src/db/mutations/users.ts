import { and, eq, isNull } from "drizzle-orm";
import type { Client, Transaction } from "@src/db/client";
import { authorizedWrite, writeIfAuthorized } from "@src/db/mutations/authorized-write";
import { refreshLikeCounts, refreshRestaurantStats, restaurantIdsReviewedBy } from "@src/db/mutations/cached-stats";
import type { NotificationPreferences } from "@src/db/mutations/notifications";
import { deletePictures, insertPictures, savingPictures } from "@src/db/mutations/pictures";
import { deleteAllSessionsOf } from "@src/db/mutations/sessions";
import * as s from "@src/db/schema";
import type { Role, User } from "@src/db/schema";
import { getSQLiteError, isUniqueConstraintError } from "@src/db/sqlite-errors";
import type { Coordinates } from "@src/map/coordinates";
import type { PictureStore } from "@src/pictures/store";

export type Profile = Pick<User, "fullname" | "username" | "pronoun" | "bio">;

function findDependentsOf(tx: Transaction, id: number) {
	const user = tx.query.users
		.findFirst({
			columns: {},
			with: {
				profilePicture: { columns: { id: true, url: true } },
				reviews: {
					columns: { restaurantId: true },
					with: { pictures: { columns: { id: true, url: true } } },
				},
				likes: { columns: { reviewId: true } },
			},
			where: { id },
		})
		.sync();
	if (!user) throw new Error(`User ${id} does not exist.`);

	const reviewPictures = user.reviews.flatMap((review) => review.pictures);
	return {
		restaurantIds: user.reviews.map((review) => review.restaurantId),
		likedReviewIds: user.likes.map((like) => like.reviewId),
		pictures: user.profilePicture ? [user.profilePicture, ...reviewPictures] : reviewPictures,
	};
}

function findWithProfilePicture(tx: Transaction, id: number) {
	return tx.query.users
		.findFirst({
			columns: { id: true, role: true, bannedAt: true },
			with: { profilePicture: { columns: { id: true, url: true } } },
			where: { id },
		})
		.sync();
}

function setBannedAt(tx: Transaction, id: number, bannedAt: Date | null) {
	const isBanning = bannedAt !== null;
	tx.update(s.users)
		.set({ bannedAt })
		.where(isBanning ? and(eq(s.users.id, id), isNull(s.users.bannedAt)) : eq(s.users.id, id))
		.run();
	refreshRestaurantStats(tx, restaurantIdsReviewedBy(tx, id));
}

export function createUserMutations(client: Client, pictures: PictureStore) {
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

		async setLocation(id: number, location: Coordinates | null, actorId: number) {
			return writeIfAuthorized(client, actorId, id, "user:edit-settings", (tx) => {
				tx.update(s.users)
					.set({ latitude: location?.latitude ?? null, longitude: location?.longitude ?? null })
					.where(eq(s.users.id, id))
					.run();
			});
		},

		async setNotificationPreferences(id: number, preferences: NotificationPreferences, actorId: number) {
			return writeIfAuthorized(client, actorId, id, "user:edit-settings", (tx) => {
				tx.update(s.users).set(preferences).where(eq(s.users.id, id)).run();
			});
		},

		async setProfilePicture(id: number, file: File, actorId: number) {
			const result = await savingPictures(
				pictures,
				[file],
				"profile",
				(urls) =>
					authorizedWrite(client, actorId, "user:edit-settings", (tx) => findWithProfilePicture(tx, id), (tx, user) => {
						const [pictureId] = insertPictures(tx, urls);
						tx.update(s.users).set({ profilePictureId: pictureId }).where(eq(s.users.id, id)).run();
						if (user.profilePicture) deletePictures(tx, [user.profilePicture.id]);
						return { replaced: user.profilePicture };
					}),
				(written) => written !== "refused",
			);
			if (result === "refused" || result === "invalid-picture") return result;
			if (result.replaced) await pictures.remove([result.replaced.url]);
			return "updated";
		},

		async removeProfilePicture(id: number, actorId: number) {
			const result = authorizedWrite(client, actorId, "user:edit-settings", (tx) => findWithProfilePicture(tx, id), (tx, user) => {
				if (user.profilePicture) deletePictures(tx, [user.profilePicture.id]);
				return { removed: user.profilePicture };
			});
			if (result === "refused") return result;
			if (result.removed) await pictures.remove([result.removed.url]);
			return "updated";
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
				setBannedAt(tx, id, new Date());
				deleteAllSessionsOf(tx, id);
			});
		},

		async unban(id: number, actorId: number) {
			return writeIfAuthorized(client, actorId, id, "user:ban", (tx) => {
				setBannedAt(tx, id, null);
			});
		},

		async delete(id: number, actorId: number) {
			const result = authorizedWrite(client, actorId, "user:delete-account", (tx) => findWithProfilePicture(tx, id), (tx) => {
				const dependents = findDependentsOf(tx, id);

				tx.update(s.restaurants).set({ suggestedBy: null }).where(eq(s.restaurants.suggestedBy, id)).run();
				tx.delete(s.users).where(eq(s.users.id, id)).run();
				deletePictures(tx, dependents.pictures.map((picture) => picture.id));
				refreshLikeCounts(tx, dependents.likedReviewIds);
				refreshRestaurantStats(tx, dependents.restaurantIds);
				return dependents;
			});
			if (result === "refused") return result;
			await pictures.remove(result.pictures.map((picture) => picture.url));
			return "updated";
		},
	};
}
