import { and, eq, isNotNull, isNull, or, sql, type SQL } from "drizzle-orm";
import { authorizedWrite, targetUserColumns, writeOnUser } from "@src/db/authorize";
import { refreshLikeCounts, refreshRestaurantStats, restaurantsReviewedBy } from "@src/db/cached-stats";
import type { Client, Transaction } from "@src/db/client";
import { collectionCount } from "@src/db/collections";
import { isFollowedBy, personCard } from "@src/db/follows";
import type { NotificationPreferences } from "@src/db/notifications";
import { cursorList } from "@src/db/pagination";
import { writeWithPictures } from "@src/db/pictures";
import { problem } from "@src/db/problem";
import * as s from "@src/db/schema";
import type { Role, User } from "@src/db/schema";
import { deleteAllSessionsOf } from "@src/db/sessions";
import { isUniqueConstraintError } from "@src/db/sqlite-errors";
import { isPublicReview, isUnbannedUser } from "@src/db/visibility";
import type { Coordinates } from "@src/map/coordinates";
import type { PageRequest } from "@src/pagination";
import type { PictureStore } from "@src/pictures/store";

export type Profile = Pick<User, "fullname" | "username" | "pronoun" | "bio">;

export const userFilters = ["all", "admin", "banned"] as const;
export type UserFilter = (typeof userFilters)[number];

type Users = typeof s.users;

const filterWhere = {
	all: () => undefined,
	admin: (user) => eq(user.role, "admin"),
	banned: (user) => isNotNull(user.bannedAt),
} satisfies Record<UserFilter, (user: Users) => SQL | undefined>;

// Admins find users by email too. Written as SQL, so that the list and its count use the same condition.
function matching(search: string, filter: UserFilter, user: Users) {
	return and(
		filterWhere[filter](user),
		search
			? or(
					sql`instr(lower(${user.username}), lower(${search})) > 0`,
					sql`instr(lower(${user.fullname}), lower(${search})) > 0`,
					sql`instr(lower(${user.email}), lower(${search})) > 0`,
				)
			: undefined,
	);
}

const newestPages = cursorList("users", ["id"], "desc");
const byUsernamePages = cursorList("users", ["username"], "asc");

// Usernames are stored in lowercase, so a link with any letter case finds the user.
function byUsername(username: string) {
	return { username: username.toLowerCase() };
}

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
			where: byUsername(username),
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
			where: byUsername(username),
		})
		.sync();
}

function setBannedAt(tx: Transaction, id: number, bannedAt: Date | null) {
	const isBanning = bannedAt !== null;
	tx.update(s.users)
		.set({ bannedAt })
		.where(isBanning ? and(eq(s.users.id, id), isNull(s.users.bannedAt)) : eq(s.users.id, id))
		.run();
	refreshRestaurantStats(tx, restaurantsReviewedBy(tx, id));
}

// How many of the follows count: those with users who are not banned.
function followCount(client: Client, side: "followers" | "following") {
	const [self, other] =
		side === "followers" ? [s.followers.followingId, s.followers.followerId] : [s.followers.followerId, s.followers.followingId];
	return (user: Users) => client.$count(s.followers, and(eq(self, user.id), isUnbannedUser(other)));
}

// Every write names the user it changes by username, finds them inside its transaction and, when it succeeds,
// returns them: the action needs the username as stored to name the page it goes back to.
export function createUsers(client: Client, pictures: PictureStore) {
	function editSettings(actorId: number, username: string, write: (tx: Transaction, user: { id: number }) => void) {
		return writeOnUser(client, actorId, username, "user:edit-settings", write);
	}

	return {
		async findByUsername(username: string) {
			return client.query.users.findFirst({ with: { profilePicture: { columns: { url: true } } }, where: byUsername(username) });
		},

		// What the Profile shows, with the counts of its lists.
		async findProfile(username: string, viewerId: number) {
			return client.query.users.findFirst({
				columns: { id: true, fullname: true, username: true, role: true, bio: true, pronoun: true, bannedAt: true, createdAt: true },
				with: { profilePicture: { columns: { url: true } } },
				extras: {
					followerCount: followCount(client, "followers"),
					followingCount: followCount(client, "following"),
					reviewCount: (user) => client.$count(s.reviews, and(eq(s.reviews.authorId, user.id), isPublicReview(s.reviews))),
					favoriteCount: collectionCount(client, "favorites"),
					bucketListCount: collectionCount(client, "bucketList"),
					isFollowedByViewer: isFollowedBy(viewerId),
				},
				where: byUsername(username),
			});
		},

		// Matches names and usernames, never email addresses: those are private. Leaves out banned users.
		async search(text: string, viewerId: number, page: PageRequest) {
			return byUsernamePages(page, (seek) =>
				client.query.users.findMany({
					...personCard(viewerId),
					...seek({
						bannedAt: { isNull: true },
						OR: [
							{ RAW: (user) => sql`instr(lower(${user.username}), lower(${text})) > 0` },
							{ RAW: (user) => sql`instr(lower(${user.fullname}), lower(${text})) > 0` },
						],
					}),
				}),
			);
		},

		// For admins. Each row carries the number of users that match, which SQLite counts once for the whole statement.
		async list(search: string, filter: UserFilter, page: PageRequest) {
			const users = await newestPages(page, (seek) =>
				client.query.users.findMany({
					columns: { id: true, fullname: true, username: true, email: true, role: true, bannedAt: true, createdAt: true },
					extras: { total: client.$count(s.users, matching(search, filter, s.users)) },
					...seek({ RAW: (user) => matching(search, filter, user) ?? sql`true` }),
				}),
			);
			return { ...users, total: users.items[0]?.total ?? 0 };
		},

		async countByFilter(): Promise<Record<UserFilter, number>> {
			const counts = await client.query.users.findFirst({
				columns: {},
				extras: {
					all: client.$count(s.users),
					admin: client.$count(s.users, filterWhere.admin(s.users)),
					banned: client.$count(s.users, filterWhere.banned(s.users)),
				},
			});
			return counts ?? { all: 0, admin: 0, banned: 0 };
		},

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
			return writeWithPictures(
				pictures,
				(changes) =>
					authorizedWrite(client, actorId, "user:edit-settings", (tx) => findWithProfilePicture(tx, username), (tx, { profilePicture, ...user }) => {
						const [pictureId] = changes.insertAdded(tx);
						tx.update(s.users).set({ profilePictureId: pictureId }).where(eq(s.users.id, user.id)).run();
						changes.remove(tx, profilePicture ? [profilePicture] : []);
						return user;
					}),
				{ files: [file], kind: "profile" },
			);
		},

		async removeProfilePicture(actorId: number, username: string) {
			return writeWithPictures(pictures, (changes) =>
				authorizedWrite(client, actorId, "user:edit-settings", (tx) => findWithProfilePicture(tx, username), (tx, { profilePicture, ...user }) => {
					changes.remove(tx, profilePicture ? [profilePicture] : []);
					return user;
				}),
			);
		},

		async setRole(actorId: number, username: string, role: Role) {
			return writeOnUser(client, actorId, username, "user:change-role", (tx, { id }) => {
				tx.update(s.users).set({ role }).where(eq(s.users.id, id)).run();
			});
		},

		// Also signs the user out everywhere. Their sessions stay deleted when the ban is lifted.
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

		// The restaurants the user suggested stay, without a suggester.
		async delete(actorId: number, username: string) {
			return writeWithPictures(pictures, (changes) =>
				authorizedWrite(client, actorId, "user:delete-account", (tx) => findWithDependents(tx, username), (tx, user) => {
					tx.update(s.restaurants).set({ suggestedBy: null }).where(eq(s.restaurants.suggestedBy, user.id)).run();
					tx.delete(s.users).where(eq(s.users.id, user.id)).run();
					changes.remove(tx, user.pictures);
					refreshLikeCounts(tx, user.likedReviewIds);
					refreshRestaurantStats(tx, user.restaurantIds);
					return { id: user.id, username: user.username };
				}),
			);
		},
	};
}
