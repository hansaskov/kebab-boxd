import type { Client } from "@src/db/client";
import { approvedRestaurant, hasUsername, publicReview, unbannedUser } from "@src/db/filters";
import { cursorList } from "@src/db/pagination";
import { personCard } from "@src/db/queries/people";
import { createReviewQueries } from "@src/db/queries/reviews";
import * as s from "@src/db/schema";
import { countRows, hasRows } from "@src/db/subqueries";
import type { PageItem, PageRequest } from "@src/pagination";
import type { ProfileTab } from "@src/validation/profile-tab";

const favoritePages = cursorList(s.favorites, ["createdAt", "restaurantId"], "desc");
const bucketListPages = cursorList(s.bucketList, ["createdAt", "restaurantId"], "desc");
const followerPages = cursorList(s.followers, ["createdAt", "followerId"], "desc");
const followingPages = cursorList(s.followers, ["createdAt", "followingId"], "desc");

const collectedRestaurant = {
	columns: { restaurantId: true, createdAt: true },
	with: {
		restaurant: {
			columns: { id: true, name: true, ratingAvg: true },
			with: { location: { columns: { city: true } } },
		},
	},
} as const;

function listFavorites(client: Client, userId: number, page: PageRequest) {
	return favoritePages(page, (seek) =>
		client.query.favorites.findMany({
			...collectedRestaurant,
			where: { AND: [{ userId, restaurant: approvedRestaurant }, seek.where] },
			orderBy: seek.orderBy,
			limit: seek.limit,
		}),
	);
}

function listBucketList(client: Client, userId: number, page: PageRequest) {
	return bucketListPages(page, (seek) =>
		client.query.bucketList.findMany({
			...collectedRestaurant,
			where: { AND: [{ userId, restaurant: approvedRestaurant }, seek.where] },
			orderBy: seek.orderBy,
			limit: seek.limit,
		}),
	);
}

function listFollowers(client: Client, userId: number, viewerId: number, page: PageRequest) {
	return followerPages(page, (seek) =>
		client.query.followers.findMany({
			columns: { followerId: true, createdAt: true },
			with: { follower: personCard(client, viewerId) },
			where: { AND: [{ followingId: userId, follower: unbannedUser }, seek.where] },
			orderBy: seek.orderBy,
			limit: seek.limit,
		}),
	);
}

function listFollowing(client: Client, userId: number, viewerId: number, page: PageRequest) {
	return followingPages(page, (seek) =>
		client.query.followers.findMany({
			columns: { followingId: true, createdAt: true },
			with: { following: personCard(client, viewerId) },
			where: { AND: [{ followerId: userId, following: unbannedUser }, seek.where] },
			orderBy: seek.orderBy,
			limit: seek.limit,
		}),
	);
}

export function createProfileQueries(client: Client) {
	const reviews = createReviewQueries(client);

	return {
		async findByUsername(username: string, viewerId: number) {
			const user = hasUsername(username);
			return client.query.users.findFirst({
				columns: {
					id: true,
					fullname: true,
					username: true,
					role: true,
					bio: true,
					pronoun: true,
					bannedAt: true,
					createdAt: true,
				},
				with: { profilePicture: { columns: { url: true } } },
				extras: {
					followerCount: () => countRows(client, "followers", { following: user, follower: unbannedUser }),
					followingCount: () => countRows(client, "followers", { follower: user, following: unbannedUser }),
					reviewCount: () => countRows(client, "reviews", { ...publicReview, author: user }),
					favoriteCount: () => countRows(client, "favorites", { user, restaurant: approvedRestaurant }),
					bucketListCount: () => countRows(client, "bucketList", { user, restaurant: approvedRestaurant }),
					isFollowedByViewer: () => hasRows(client, "followers", { followerId: viewerId, following: user }),
				},
				where: user,
			});
		},

		async list(userId: number, viewerId: number, tab: ProfileTab, page: PageRequest) {
			switch (tab) {
				case "reviews":
					return { tab, page: await reviews.listPublicByAuthor(userId, viewerId, page) };
				case "favorites":
					return { tab, page: await listFavorites(client, userId, page) };
				case "bucket-list":
					return { tab, page: await listBucketList(client, userId, page) };
				case "followers":
					return { tab, page: await listFollowers(client, userId, viewerId, page) };
				case "following":
					return { tab, page: await listFollowing(client, userId, viewerId, page) };
			}
		},
	};
}

export type CollectedRestaurant = PageItem<Awaited<ReturnType<typeof listFavorites>>>;
