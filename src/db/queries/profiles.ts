import type { Client } from "@src/db/client";
import { approvedRestaurant, hasUsername, publicReview, unbannedUser } from "@src/db/filters";
import { cursorList } from "@src/db/pagination";
import * as s from "@src/db/schema";
import { countRows, hasRows } from "@src/db/subqueries";
import type { Page, PageRequest } from "@src/pagination";
import type { ProfileTab } from "@src/validation/profile-tab";

const reviewPages = cursorList(s.reviews, ["createdAt", "id"], "desc");
const favoritePages = cursorList(s.favorites, ["createdAt", "restaurantId"], "desc");
const bucketListPages = cursorList(s.bucketList, ["createdAt", "restaurantId"], "desc");

const collectedRestaurant = {
	columns: { restaurantId: true, createdAt: true },
	with: {
		restaurant: {
			columns: { name: true, ratingAvg: true },
			with: { location: { columns: { city: true } } },
		},
	},
} as const;

function listReviews(client: Client, userId: number, page: PageRequest) {
	return reviewPages(page, (seek) =>
		client.query.reviews.findMany({
			columns: { id: true, rating: true, description: true, likeCount: true, createdAt: true },
			with: { restaurant: { columns: { name: true } } },
			where: { AND: [{ ...publicReview, authorId: userId }, seek.where] },
			orderBy: seek.orderBy,
			limit: seek.limit,
		}),
	);
}

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

export function createProfileQueries(client: Client) {
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

		async list(userId: number, tab: ProfileTab, page: PageRequest) {
			switch (tab) {
				case "reviews":
					return { tab, page: await listReviews(client, userId, page) };
				case "favorites":
					return { tab, page: await listFavorites(client, userId, page) };
				case "bucket-list":
					return { tab, page: await listBucketList(client, userId, page) };
			}
		},
	};
}

type Item<List> = List extends Page<infer Row> ? Row : never;

export type ProfileReview = Item<Awaited<ReturnType<typeof listReviews>>>;
export type CollectedRestaurant = Item<Awaited<ReturnType<typeof listFavorites>>>;
