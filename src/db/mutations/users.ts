import { and, eq, isNull } from "drizzle-orm";
import type { Client, Transaction } from "@src/db/client";
import { authorizedWrite, isProblem, problem, targetUserColumns, writeOnUser, type Problem } from "@src/db/mutations/authorize";
import { refreshLikeCounts, refreshRestaurantStats, restaurantsReviewedBy } from "@src/db/mutations/cached-stats";
import type { NotificationPreferences } from "@src/db/mutations/notifications";
import { deletePictures, insertPictures, savingPictures } from "@src/db/mutations/pictures";
import { deleteAllSessionsOf } from "@src/db/mutations/sessions";
import * as s from "@src/db/schema";
import type { Role, User } from "@src/db/schema";
import { isUniqueConstraintError } from "@src/db/sqlite-errors";
import type { Coordinates } from "@src/map/coordinates";
import type { PictureStore } from "@src/pictures/store";

export type Profile = Pick<User, "fullname" | "username" | "pronoun" | "bio">;

type Picture = { id: number; url: string };

// The user as the permission needs them, with the rows and files that go when the account is deleted.
function findWithDependents(tx: Transaction, username: string) {
	const user = tx.query.users
		.findFirst({
			columns: targetUserColumns,
			with: {
				profilePicture: { columns: { id: true, url: true } },
				reviews: {
					columns: { restaurantId: true },
					with: { pictures: { columns: { id: true, url: true } } },
				},
				likes: { columns: { reviewId: true } },
			},
			where: { username: username.toLowerCase() },
		})
		.sync();
	if (!user) return undefined;

	const { profilePicture, reviews, likes, ...target } = user;
	const reviewPictures = reviews.flatMap((review) => review.pictures);
	return {
		...target,
		restaurantIds: reviews.map((review) => review.restaurantId),
		likedReviewIds: likes.map((like) => like.reviewId),
		pictures: profilePicture ? [profilePicture, ...reviewPictures] : reviewPictures,
	};
}

function findWithProfilePicture(tx: Transaction, username: string) {
	return tx.query.users
		.findFirst({
			columns: targetUserColumns,
			with: { profilePicture: { columns: { id: true, url: true } } },
			where: { username: username.toLowerCase() },
		})
		.sync();
}

// The user a picture write returns, and the picture whose file goes after it.
function withPicture({ profilePicture, ...user }: NonNullable<ReturnType<typeof findWithProfilePicture>>) {
	return { user, removed: profilePicture ? [profilePicture] : [] };
}

function setBannedAt(tx: Transaction, id: number, bannedAt: Date | null) {
	const isBanning = bannedAt !== null;
	tx.update(s.users)
		.set({ bannedAt })
		.where(isBanning ? and(eq(s.users.id, id), isNull(s.users.bannedAt)) : eq(s.users.id, id))
		.run();
	refreshRestaurantStats(tx, restaurantsReviewedBy(tx, id));
}

type Target = { id: number; username: string };

// Every mutation names the user it changes by username, finds them inside its transaction and, when it
// succeeds, returns them: the action needs the username as stored to name the page it goes back to.
export function createUserMutations(client: Client, pictures: PictureStore) {
	// The files of the pictures go once the rows that point to them are gone.
	async function removingFiles(result: { user: Target; removed: Picture[] } | Problem) {
		if (isProblem(result)) return result;
		await pictures.remove(result.removed.map((picture) => picture.url));
		return result.user;
	}

	function editSettings(actorId: number, username: string, write: (tx: Transaction, user: Target) => void) {
		return writeOnUser(client, actorId, username, "user:edit-settings", write);
	}

	return {
		async updateProfile(actorId: number, username: string, profile: Profile) {
			try {
				return editSettings(actorId, username, (tx, { id }) => {
					tx.update(s.users).set(profile).where(eq(s.users.id, id)).run();
				});
			} catch (error) {
				if (isUniqueConstraintError(error)) return problem("username-taken");
				throw error;
			}
		},

		async setLocation(actorId: number, username: string, location: Coordinates | null) {
			return editSettings(actorId, username, (tx, { id }) => {
				tx.update(s.users)
					.set({ latitude: location?.latitude ?? null, longitude: location?.longitude ?? null })
					.where(eq(s.users.id, id))
					.run();
			});
		},

		async setNotificationPreferences(actorId: number, username: string, preferences: NotificationPreferences) {
			return editSettings(actorId, username, (tx, { id }) => {
				tx.update(s.users).set(preferences).where(eq(s.users.id, id)).run();
			});
		},

		async setProfilePicture(actorId: number, username: string, file: File) {
			const result = await savingPictures(pictures, [file], "profile", (urls) =>
				authorizedWrite(client, actorId, "user:edit-settings", (tx) => findWithProfilePicture(tx, username), (tx, user) => {
					const [pictureId] = insertPictures(tx, urls);
					tx.update(s.users).set({ profilePictureId: pictureId }).where(eq(s.users.id, user.id)).run();
					if (user.profilePicture) deletePictures(tx, [user.profilePicture.id]);
					return withPicture(user);
				}),
			);
			return removingFiles(result);
		},

		async removeProfilePicture(actorId: number, username: string) {
			const result = authorizedWrite(client, actorId, "user:edit-settings", (tx) => findWithProfilePicture(tx, username), (tx, user) => {
				if (user.profilePicture) deletePictures(tx, [user.profilePicture.id]);
				return withPicture(user);
			});
			return removingFiles(result);
		},

		async verifyEmail(id: number) {
			await client.update(s.users).set({ emailVerified: true }).where(eq(s.users.id, id));
		},

		async setRole(actorId: number, username: string, role: Role) {
			return writeOnUser(client, actorId, username, "user:change-role", (tx, { id }) => {
				tx.update(s.users).set({ role }).where(eq(s.users.id, id)).run();
			});
		},

		async ban(actorId: number, username: string) {
			return writeOnUser(client, actorId, username, "user:ban", (tx, { id }) => {
				setBannedAt(tx, id, new Date());
				deleteAllSessionsOf(tx, id);
			});
		},

		async unban(actorId: number, username: string) {
			return writeOnUser(client, actorId, username, "user:ban", (tx, { id }) => {
				setBannedAt(tx, id, null);
			});
		},

		async signOutEverywhere(actorId: number, username: string) {
			return writeOnUser(client, actorId, username, "user:manage-sessions", (tx, { id }) => {
				deleteAllSessionsOf(tx, id);
			});
		},

		async delete(actorId: number, username: string) {
			const result = authorizedWrite(client, actorId, "user:delete-account", (tx) => findWithDependents(tx, username), (tx, dependents) => {
				const { id } = dependents;
				tx.update(s.restaurants).set({ suggestedBy: null }).where(eq(s.restaurants.suggestedBy, id)).run();
				tx.delete(s.users).where(eq(s.users.id, id)).run();
				deletePictures(tx, dependents.pictures.map((picture) => picture.id));
				refreshLikeCounts(tx, dependents.likedReviewIds);
				refreshRestaurantStats(tx, dependents.restaurantIds);
				return { user: { id, username: dependents.username }, removed: dependents.pictures };
			});
			return removingFiles(result);
		},
	};
}
