import { and, eq, isNotNull, isNull, or, sql, type SQL } from "drizzle-orm";
import type { UserPermission } from "@src/auth/permissions";
import { authorizedRead, authorizedSubjectRead, targetUserColumns, writeOnUser } from "@src/db/authorize";
import { refreshAuthorStats, refreshLikeCounts, refreshRestaurantStats, restaurantsReviewedBy } from "@src/db/cached-stats";
import type { Client, Transaction } from "@src/db/client";
import { collectionCount } from "@src/restaurants/collections.db";
import { approveAllFollowRequests, followRequestCount, isRequestedBy, personCard } from "@src/follows/follows.db";
import type { NotificationPreferences } from "@src/notifications/notifications.db";
import { cursorList, type Filter, type Seek } from "@src/db/pagination";
import { authorizedWriteWithPictures } from "@src/pictures/pictures.db";
import { problem } from "@src/db/problem";
import * as s from "@src/db/schema";
import type { Role, User } from "@src/db/schema";
import type { PersonSort, UserFilter } from "@src/users/users";
import { deleteAllSessionsOf } from "@src/auth/sessions.db";
import { isUniqueConstraintError } from "@src/db/sqlite-errors";
import { isFollowedBy, isUnbannedUser } from "@src/db/visibility";
import type { Coordinates } from "@src/map/coordinates";
import type { PageRequest } from "@src/pagination";
import type { PictureStore } from "@src/pictures/store";
import { fewMatchesLimit, matchText, startsWith, startsWithIgnoringCase, type TextIndex, type TextMatch } from "@src/db/text-search";

export type Profile = Pick<User, "fullname" | "username" | "pronoun" | "bio">;

type Users = typeof s.users;

export interface UserTotal {
	count: number;
	isAtLeast: boolean;
}

const filterWhere = {
	all: () => undefined,
	admin: (user) => eq(user.role, "admin"),
	banned: (user) => isNotNull(user.bannedAt),
} satisfies Record<UserFilter, (user: Users) => SQL | undefined>;

function nameStartsWith(user: Users, prefix: string) {
	return or(startsWith(user.username, prefix.toLowerCase()), startsWithIgnoringCase(user.fullname, prefix)) ?? sql`false`;
}

const nameText: TextIndex<Users> = {
	table: s.users,
	searchTable: "user_search",
	searchedColumns: ["username", "fullname"],
	startsWith: nameStartsWith,
};

const accountText: TextIndex<Users> = {
	table: s.users,
	searchTable: "user_search",
	searchedColumns: ["username", "fullname", "email"],
	startsWith: (user, prefix) => or(nameStartsWith(user, prefix), startsWithIgnoringCase(user.email, prefix)) ?? sql`false`,
};

function matchingName(client: Client, text: string): Filter<"users"> {
	if (!text) return {};
	const { matches } = matchText(client, nameText, text);
	return { RAW: (user) => matches(user) };
}

const newestPages = cursorList("users", ["id"], "desc");
const mostReviewsPages = cursorList("users", ["publicReviewCount", "id"], "desc");
const latestReviewPages = cursorList("users", ["latestReviewAt", "id"], "desc");

function byUsername(username: string) {
	return { username: username.toLowerCase() };
}

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

function followCount(client: Client, side: "followers" | "following") {
	const [self, other] =
		side === "followers" ? [s.followers.followingId, s.followers.followerId] : [s.followers.followerId, s.followers.followingId];
	return (user: Users) => client.$count(s.followers, and(eq(self, user.id), isUnbannedUser(other)));
}

export function createUsers(client: Client, pictures: PictureStore) {
	function editSettings(actorId: number, username: string, write: (tx: Transaction, user: { id: number }) => void) {
		return writeOnUser(client, actorId, username, "user:edit-settings", write);
	}

	async function countMatching(filter: UserFilter, found: TextMatch<Users> | undefined, matching: (user: Users) => SQL): Promise<UserTotal> {
		if (!found) {
			const counted = await client.query.userCounts.findFirst({ columns: { count: true }, where: { filter } });
			return { count: counted?.count ?? 0, isAtLeast: false };
		}
		if (found.fewIds === undefined) return { count: fewMatchesLimit, isAtLeast: true };
		return { count: await client.$count(s.users, matching(s.users)), isAtLeast: false };
	}

	return {
		async findInAdminConsole(username: string, viewerId: number | null) {
			return authorizedSubjectRead(client, viewerId, "admin-console:view", () =>
				client.query.users.findFirst({ with: { profilePicture: { columns: { url: true } } }, where: byUsername(username) }),
			);
		},

		async findAllowed(username: string, viewerId: number | null, permission: UserPermission) {
			const user = await client.query.users.findFirst({ with: { profilePicture: { columns: { url: true } } }, where: byUsername(username) });
			return authorizedRead(client, viewerId, permission, user, async (found) => found);
		},

		async findProfile(username: string, viewerId: number | null) {
			return client.query.users.findFirst({
				columns: {
					id: true,
					fullname: true,
					username: true,
					role: true,
					bio: true,
					pronoun: true,
					isPrivate: true,
					publicReviewCount: true,
					bannedAt: true,
					createdAt: true,
				},
				with: { profilePicture: { columns: { url: true } } },
				extras: {
					followerCount: followCount(client, "followers"),
					followingCount: followCount(client, "following"),
					allReviewCount: (user) => client.$count(s.reviews, eq(s.reviews.authorId, user.id)),
					favoriteCount: collectionCount(client, "favorites"),
					bucketListCount: collectionCount(client, "bucketList"),
					followRequestCount: followRequestCount(client),
					isFollowedByViewer: isFollowedBy(viewerId),
					isRequestedByViewer: isRequestedBy(viewerId),
				},
				where: byUsername(username),
			});
		},

		async search(text: string, sort: PersonSort, viewerId: number | null, page: PageRequest) {
			const card = personCard(viewerId);
			const found = matchingName(client, text);
			const read = (seek: Seek<"users">) =>
				client.query.users.findMany({
					...card,
					columns: { ...card.columns, publicReviewCount: true, latestReviewAt: true },
					...seek({ AND: [{ bannedAt: { isNull: true } }, found] }),
				});
			switch (sort) {
				case "most-reviews":
					return mostReviewsPages(page, read);
				case "latest-review":
					return latestReviewPages(page, read);
			}
		},

		async list(search: string, filter: UserFilter, viewerId: number | null, page: PageRequest) {
			return authorizedSubjectRead(client, viewerId, "admin-console:view", async () => {
				const found = search ? matchText(client, accountText, search) : undefined;
				const matching = (user: Users) => and(filterWhere[filter](user), found?.matches(user)) ?? sql`true`;
				const users = await newestPages(page, (seek) =>
					client.query.users.findMany({
						columns: { id: true, fullname: true, username: true, email: true, role: true, bannedAt: true, createdAt: true },
						...seek({ RAW: matching }),
					}),
				);
				return { ...users, total: await countMatching(filter, found, matching) };
			});
		},

		async countByFilter(viewerId: number | null) {
			return authorizedSubjectRead(client, viewerId, "admin-console:view", async (): Promise<Record<UserFilter, number>> => {
				const rows = await client.query.userCounts.findMany();
				const counts = { all: 0, admin: 0, banned: 0 };
				for (const { filter, count } of rows) counts[filter] = count;
				return counts;
			});
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
			return writeOnUser(client, actorId, username, "user:edit-location", (tx, { id }) => {
				tx.update(s.users)
					.set({ latitude: location?.latitude ?? null, longitude: location?.longitude ?? null })
					.where(eq(s.users.id, id))
					.run();
			});
		},

		async setPrivacy(actorId: number, username: string, isPrivate: boolean) {
			return editSettings(actorId, username, (tx, { id }) => {
				tx.update(s.users).set({ isPrivate }).where(eq(s.users.id, id)).run();
				refreshAuthorStats(tx, [id]);
				if (!isPrivate) approveAllFollowRequests(tx, id);
			});
		},

		async setNotificationPreferences(actorId: number, username: string, preferences: NotificationPreferences) {
			return editSettings(actorId, username, (tx, { id }) => {
				tx.update(s.users).set(preferences).where(eq(s.users.id, id)).run();
			});
		},

		async setProfilePicture(actorId: number, username: string, file: File) {
			return authorizedWriteWithPictures(
				client,
				pictures,
				actorId,
				"user:edit-settings",
				(tx) => findWithProfilePicture(tx, username),
				(tx, { profilePicture, ...user }, changes) => {
					const [pictureId] = changes.insertAdded(tx);
					tx.update(s.users).set({ profilePictureId: pictureId }).where(eq(s.users.id, user.id)).run();
					changes.remove(tx, profilePicture ? [profilePicture] : []);
					return user;
				},
				{ files: [file], kind: "profile" },
			);
		},

		async removeProfilePicture(actorId: number, username: string) {
			return authorizedWriteWithPictures(
				client,
				pictures,
				actorId,
				"user:edit-settings",
				(tx) => findWithProfilePicture(tx, username),
				(tx, { profilePicture, ...user }, changes) => {
					changes.remove(tx, profilePicture ? [profilePicture] : []);
					return user;
				},
			);
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
			return authorizedWriteWithPictures(client, pictures, actorId, "user:delete-account", (tx) => findWithDependents(tx, username), (tx, user, changes) => {
				tx.update(s.restaurants).set({ suggestedBy: null }).where(eq(s.restaurants.suggestedBy, user.id)).run();
				tx.delete(s.users).where(eq(s.users.id, user.id)).run();
				changes.remove(tx, user.pictures);
				refreshLikeCounts(tx, user.likedReviewIds);
				refreshRestaurantStats(tx, user.restaurantIds);
				return { id: user.id, username: user.username };
			});
		},
	};
}
