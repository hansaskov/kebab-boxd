import type { Client } from "@src/db/client";
import { countRows } from "@src/db/count";
import { approvedRestaurant, hasUsername, publicReviewBy, unbannedUser } from "@src/db/filters";
import { cursorList } from "@src/db/pagination";
import * as s from "@src/db/schema";
import type { Page, PageRequest } from "@src/pagination";

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

export function createProfileQueries(client: Client) {
	return {
		async findByUsername(username: string) {
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
				where: hasUsername(username),
			});
		},

		async countTotals(userId: number) {
			const [followers, following, reviews, favorites, bucketList] = await Promise.all([
				countRows(client, "followers", { followingId: userId, follower: unbannedUser }),
				countRows(client, "followers", { followerId: userId, following: unbannedUser }),
				countRows(client, "reviews", publicReviewBy(userId)),
				countRows(client, "favorites", { userId, restaurant: approvedRestaurant }),
				countRows(client, "bucketList", { userId, restaurant: approvedRestaurant }),
			]);
			return { followers, following, reviews, favorites, bucketList };
		},

		async isFollowing(followerId: number, followingId: number) {
			const follow = await client.query.followers.findFirst({
				columns: { followerId: true },
				where: { followerId, followingId },
			});
			return follow !== undefined;
		},

		async listReviews(userId: number, page: PageRequest) {
			return reviewPages(page, (seek) =>
				client.query.reviews.findMany({
					columns: { id: true, rating: true, description: true, likeCount: true, createdAt: true },
					with: { restaurant: { columns: { name: true } } },
					where: { AND: [publicReviewBy(userId), seek.where] },
					orderBy: seek.orderBy,
					limit: seek.limit,
				}),
			);
		},

		async listFavorites(userId: number, page: PageRequest) {
			return favoritePages(page, (seek) =>
				client.query.favorites.findMany({
					...collectedRestaurant,
					where: { AND: [{ userId, restaurant: approvedRestaurant }, seek.where] },
					orderBy: seek.orderBy,
					limit: seek.limit,
				}),
			);
		},

		async listBucketList(userId: number, page: PageRequest) {
			return bucketListPages(page, (seek) =>
				client.query.bucketList.findMany({
					...collectedRestaurant,
					where: { AND: [{ userId, restaurant: approvedRestaurant }, seek.where] },
					orderBy: seek.orderBy,
					limit: seek.limit,
				}),
			);
		},
	};
}

type ProfileQueries = ReturnType<typeof createProfileQueries>;
type Item<List> = List extends Page<infer Row> ? Row : never;

export type ProfileReview = Item<Awaited<ReturnType<ProfileQueries["listReviews"]>>>;
export type CollectedRestaurant = Item<Awaited<ReturnType<ProfileQueries["listFavorites"]>>>;
