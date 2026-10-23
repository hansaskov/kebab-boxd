import { and, count, eq, inArray, isNull, lte, sql } from "drizzle-orm";
import type { Client } from "@src/db/client";
import { cursorList } from "@src/db/pagination";
import { reviewWindowPosition, reviewWindowSize } from "@src/db/review-window";
import * as s from "@src/db/schema";
import type { Page, PageRequest } from "@src/pagination";

type RestaurantCollection = typeof s.favorites | typeof s.bucketList;

const isApproved = eq(s.restaurants.status, "approved");

function windowedReviewIds(client: Client) {
	const windowed = client
		.select({ id: s.reviews.id, position: reviewWindowPosition().as("position") })
		.from(s.reviews)
		.where(eq(s.reviews.authorId, sql.placeholder("userId")))
		.as("windowed");

	return client.select({ id: windowed.id }).from(windowed).where(lte(windowed.position, reviewWindowSize));
}

function isPublicReviewOfUser(client: Client) {
	return and(
		eq(s.reviews.authorId, sql.placeholder("userId")),
		inArray(s.reviews.id, windowedReviewIds(client)),
		isApproved,
	);
}

function prepareReviewList(client: Client) {
	return cursorList(s.reviews, ["createdAt", "id"], "desc", (seek) =>
		client
			.select({
				id: s.reviews.id,
				rating: s.reviews.rating,
				description: s.reviews.description,
				likeCount: s.reviews.likeCount,
				createdAt: s.reviews.createdAt,
				restaurant: s.restaurants.name,
			})
			.from(s.reviews)
			.innerJoin(s.restaurants, eq(s.restaurants.id, s.reviews.restaurantId))
			.where(and(isPublicReviewOfUser(client), seek.where))
			.orderBy(...seek.orderBy)
			.limit(seek.limit)
			.prepare(),
	);
}

function prepareRestaurantList<Collection extends RestaurantCollection>(client: Client, collection: Collection) {
	return cursorList(collection, ["createdAt", "restaurantId"], "desc", (seek) =>
		client
			.select({
				restaurantId: collection.restaurantId,
				createdAt: collection.createdAt,
				name: s.restaurants.name,
				city: s.locations.city,
				ratingAvg: s.restaurants.ratingAvg,
			})
			.from(collection)
			.innerJoin(s.restaurants, eq(s.restaurants.id, collection.restaurantId))
			.innerJoin(s.locations, eq(s.locations.id, s.restaurants.locationId))
			.where(and(eq(collection.userId, sql.placeholder("userId")), isApproved, seek.where))
			.orderBy(...seek.orderBy)
			.limit(seek.limit)
			.prepare(),
	);
}

function countRestaurants(client: Client, collection: RestaurantCollection) {
	return client
		.select({ count: count() })
		.from(collection)
		.innerJoin(s.restaurants, eq(s.restaurants.id, collection.restaurantId))
		.where(and(eq(collection.userId, sql.placeholder("userId")), isApproved));
}

function countUnbannedFollows(client: Client, direction: "followers" | "following") {
	const [self, other] =
		direction === "following"
			? [s.followers.followerId, s.followers.followingId]
			: [s.followers.followingId, s.followers.followerId];

	return client
		.select({ count: count() })
		.from(s.followers)
		.innerJoin(s.users, eq(s.users.id, other))
		.where(and(eq(self, sql.placeholder("userId")), isNull(s.users.bannedAt)));
}

export function createProfileQueries(client: Client) {
	const byUsername = client.query.users
		.findFirst({
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
			where: { username: sql.placeholder("username") },
		})
		.prepare();

	const totals = client
		.select({
			followers: sql<number>`(${countUnbannedFollows(client, "followers")})`.mapWith(Number),
			following: sql<number>`(${countUnbannedFollows(client, "following")})`.mapWith(Number),
			reviews: sql<number>`(${client
				.select({ count: count() })
				.from(s.reviews)
				.innerJoin(s.restaurants, eq(s.restaurants.id, s.reviews.restaurantId))
				.where(isPublicReviewOfUser(client))})`.mapWith(Number),
			favorites: sql<number>`(${countRestaurants(client, s.favorites)})`.mapWith(Number),
			bucketList: sql<number>`(${countRestaurants(client, s.bucketList)})`.mapWith(Number),
		})
		.from(s.users)
		.where(eq(s.users.id, sql.placeholder("userId")))
		.prepare();

	const follow = client
		.select({ followerId: s.followers.followerId })
		.from(s.followers)
		.where(
			and(
				eq(s.followers.followerId, sql.placeholder("followerId")),
				eq(s.followers.followingId, sql.placeholder("followingId")),
			),
		)
		.prepare();

	const reviews = prepareReviewList(client);
	const favorites = prepareRestaurantList(client, s.favorites);
	const bucketList = prepareRestaurantList(client, s.bucketList);

	return {
		async findByUsername(username: string) {
			const user = await byUsername.execute({ username: username.toLowerCase() });
			if (!user) return undefined;

			const { profilePicture, ...profile } = user;
			return { ...profile, profilePicture: profilePicture?.url ?? null };
		},

		async countTotals(userId: number) {
			return totals.get({ userId }) ?? { followers: 0, following: 0, reviews: 0, favorites: 0, bucketList: 0 };
		},

		async isFollowing(followerId: number, followingId: number) {
			return follow.get({ followerId, followingId }) !== undefined;
		},

		async listReviews(userId: number, page: PageRequest) {
			return reviews(page, { userId });
		},

		async listFavorites(userId: number, page: PageRequest) {
			return favorites(page, { userId });
		},

		async listBucketList(userId: number, page: PageRequest) {
			return bucketList(page, { userId });
		},
	};
}

type ProfileQueries = ReturnType<typeof createProfileQueries>;
type Item<List> = List extends Page<infer Row> ? Row : never;

export type ProfileReview = Item<Awaited<ReturnType<ProfileQueries["listReviews"]>>>;
export type CollectedRestaurant = Item<Awaited<ReturnType<ProfileQueries["listFavorites"]>>>;
