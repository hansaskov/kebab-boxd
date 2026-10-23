import { asc, eq, sql } from "drizzle-orm";
import { alias } from "drizzle-orm/sqlite-core";
import type { Client } from "@src/db/client";
import * as s from "@src/db/schema";
import { toStars } from "@src/format/rating";

function prepareRestaurantList(client: Client, table: typeof s.favorites | typeof s.bucketList) {
	return client
		.select({ restaurant: s.restaurants.name, addedAt: table.createdAt })
		.from(table)
		.innerJoin(s.restaurants, eq(s.restaurants.id, table.restaurantId))
		.where(eq(table.userId, sql.placeholder("userId")))
		.orderBy(asc(table.createdAt))
		.prepare();
}

function prepareFollowList(client: Client, direction: "followers" | "following") {
	const [self, other] =
		direction === "following"
			? [s.followers.followerId, s.followers.followingId]
			: [s.followers.followingId, s.followers.followerId];

	return client
		.select({ username: s.users.username, since: s.followers.createdAt })
		.from(s.followers)
		.innerJoin(s.users, eq(s.users.id, other))
		.where(eq(self, sql.placeholder("userId")))
		.orderBy(asc(s.followers.createdAt))
		.prepare();
}

export function createPersonalDataQueries(client: Client) {
	const profile = client.query.users
		.findFirst({
			columns: {
				fullname: true,
				username: true,
				email: true,
				emailVerified: true,
				role: true,
				bio: true,
				pronoun: true,
				latitude: true,
				longitude: true,
				bannedAt: true,
				createdAt: true,
				updatedAt: true,
			},
			with: { profilePicture: { columns: { url: true } } },
			where: { id: sql.placeholder("userId") },
		})
		.prepare();

	const accounts = client.query.accounts
		.findMany({
			columns: { providerId: true, accountId: true, createdAt: true },
			where: { userId: sql.placeholder("userId") },
			orderBy: { createdAt: "asc" },
		})
		.prepare();

	const sessions = client.query.sessions
		.findMany({
			columns: { createdAt: true, lastVerifiedAt: true, theme: true },
			with: {
				history: {
					columns: { requestedAt: true, method: true, path: true, action: true, status: true, prefetched: true },
					orderBy: { requestedAt: "asc" },
				},
			},
			where: { userId: sql.placeholder("userId") },
			orderBy: { createdAt: "asc" },
		})
		.prepare();

	const reviews = client.query.reviews
		.findMany({
			columns: { rating: true, description: true, likeCount: true, createdAt: true, updatedAt: true },
			with: {
				restaurant: { columns: { name: true } },
				pictures: { columns: { url: true } },
			},
			where: { authorId: sql.placeholder("userId") },
			orderBy: { createdAt: "asc" },
		})
		.prepare();

	const reviewAuthor = alias(s.users, "review_author");
	const likes = client
		.select({ author: reviewAuthor.username, restaurant: s.restaurants.name, likedAt: s.likes.createdAt })
		.from(s.likes)
		.innerJoin(s.reviews, eq(s.reviews.id, s.likes.reviewId))
		.innerJoin(reviewAuthor, eq(reviewAuthor.id, s.reviews.authorId))
		.innerJoin(s.restaurants, eq(s.restaurants.id, s.reviews.restaurantId))
		.where(eq(s.likes.userId, sql.placeholder("userId")))
		.orderBy(asc(s.likes.createdAt))
		.prepare();

	const following = prepareFollowList(client, "following");
	const followers = prepareFollowList(client, "followers");
	const favorites = prepareRestaurantList(client, s.favorites);
	const bucketList = prepareRestaurantList(client, s.bucketList);

	const suggestions = client
		.select({ restaurant: s.restaurants.name, status: s.restaurants.status, suggestedAt: s.restaurants.createdAt })
		.from(s.restaurants)
		.where(eq(s.restaurants.suggestedBy, sql.placeholder("userId")))
		.orderBy(asc(s.restaurants.createdAt))
		.prepare();

	return {
		async findByUser(userId: number) {
			const values = { userId };
			const user = await profile.execute(values);
			if (!user) return undefined;

			const { profilePicture, ...details } = user;

			return {
				profile: { ...details, profilePicture: profilePicture?.url ?? null },
				accounts: await accounts.execute(values),
				sessions: await sessions.execute(values),
				reviews: (await reviews.execute(values)).map(({ rating, restaurant, pictures, ...review }) => ({
					restaurant: restaurant.name,
					stars: toStars(rating),
					...review,
					pictures: pictures.map((picture) => picture.url),
				})),
				likes: likes.all(values),
				following: following.all(values),
				followers: followers.all(values),
				favorites: favorites.all(values),
				bucketList: bucketList.all(values),
				suggestions: suggestions.all(values),
			};
		},
	};
}

export type PersonalData = NonNullable<Awaited<ReturnType<ReturnType<typeof createPersonalDataQueries>["findByUser"]>>>;
