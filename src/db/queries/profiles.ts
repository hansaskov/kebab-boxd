import { and, eq, exists, isNull, sql } from "drizzle-orm";
import type { Client } from "@src/db/client";
import { cursorList } from "@src/db/pagination";
import { personCard } from "@src/db/queries/people";
import { isInReviewWindow } from "@src/db/review-window";
import * as s from "@src/db/schema";
import type { PageRequest } from "@src/pagination";

const favoritePages = cursorList("favorites", ["createdAt", "restaurantId"], "desc");
const bucketListPages = cursorList("bucketList", ["createdAt", "restaurantId"], "desc");
const followerPages = cursorList("followers", ["createdAt", "followerId"], "desc");
const followingPages = cursorList("followers", ["createdAt", "followingId"], "desc");

const collectedRestaurant = {
	columns: { restaurantId: true, createdAt: true },
	with: {
		restaurant: {
			columns: { id: true, name: true, ratingAvg: true },
			with: { location: { columns: { city: true } } },
		},
	},
} as const;

export function createProfileQueries(client: Client) {
	return {
		async findByUsername(username: string, viewerId: number) {
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
					followerCount: (user) =>
						client.$count(
							s.followers,
							and(
								eq(s.followers.followingId, user.id),
								exists(
									client
										.select({ row: sql`1` })
										.from(s.users)
										.where(and(eq(s.users.id, s.followers.followerId), isNull(s.users.bannedAt))),
								),
							),
						),
					followingCount: (user) =>
						client.$count(
							s.followers,
							and(
								eq(s.followers.followerId, user.id),
								exists(
									client
										.select({ row: sql`1` })
										.from(s.users)
										.where(and(eq(s.users.id, s.followers.followingId), isNull(s.users.bannedAt))),
								),
							),
						),
					reviewCount: (user) =>
						client.$count(
							s.reviews,
							and(
								eq(s.reviews.authorId, user.id),
								isInReviewWindow(s.reviews),
								exists(
									client
										.select({ row: sql`1` })
										.from(s.restaurants)
										.where(and(eq(s.restaurants.id, s.reviews.restaurantId), eq(s.restaurants.status, "approved"))),
								),
							),
						),
					favoriteCount: (user) =>
						client.$count(
							s.favorites,
							and(
								eq(s.favorites.userId, user.id),
								exists(
									client
										.select({ row: sql`1` })
										.from(s.restaurants)
										.where(and(eq(s.restaurants.id, s.favorites.restaurantId), eq(s.restaurants.status, "approved"))),
								),
							),
						),
					bucketListCount: (user) =>
						client.$count(
							s.bucketList,
							and(
								eq(s.bucketList.userId, user.id),
								exists(
									client
										.select({ row: sql`1` })
										.from(s.restaurants)
										.where(and(eq(s.restaurants.id, s.bucketList.restaurantId), eq(s.restaurants.status, "approved"))),
								),
							),
						),
					isFollowedByViewer: (user) =>
						exists(
							client
								.select({ row: sql`1` })
								.from(s.followers)
								.where(and(eq(s.followers.followerId, viewerId), eq(s.followers.followingId, user.id))),
						).mapWith(Boolean),
				},
				where: { username: username.toLowerCase() },
			});
		},

		async listFavorites(userId: number, page: PageRequest) {
			return favoritePages(page, (seek) =>
				client.query.favorites.findMany({
					...collectedRestaurant,
					...seek({ userId, restaurant: { status: "approved" } }),
				}),
			);
		},

		async listBucketList(userId: number, page: PageRequest) {
			return bucketListPages(page, (seek) =>
				client.query.bucketList.findMany({
					...collectedRestaurant,
					...seek({ userId, restaurant: { status: "approved" } }),
				}),
			);
		},

		async listFollowers(userId: number, viewerId: number, page: PageRequest) {
			return followerPages(page, (seek) =>
				client.query.followers.findMany({
					columns: { followerId: true, createdAt: true },
					with: { follower: personCard(client, viewerId) },
					...seek({ followingId: userId, follower: { bannedAt: { isNull: true } } }),
				}),
			);
		},

		async listFollowing(userId: number, viewerId: number, page: PageRequest) {
			return followingPages(page, (seek) =>
				client.query.followers.findMany({
					columns: { followingId: true, createdAt: true },
					with: { following: personCard(client, viewerId) },
					...seek({ followerId: userId, following: { bannedAt: { isNull: true } } }),
				}),
			);
		},
	};
}

