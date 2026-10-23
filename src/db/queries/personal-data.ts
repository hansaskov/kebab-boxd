import type { Client } from "@src/db/client";
import { toStars } from "@src/format/rating";

function collectedRestaurant(userId: number) {
	return {
		columns: { createdAt: true },
		with: { restaurant: { columns: { name: true } } },
		where: { userId },
		orderBy: { createdAt: "asc" },
	} as const;
}

export function createPersonalDataQueries(client: Client) {
	const findProfile = (userId: number) =>
		client.query.users.findFirst({
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
			where: { id: userId },
		});

	const listAccounts = (userId: number) =>
		client.query.accounts.findMany({
			columns: { providerId: true, accountId: true, createdAt: true },
			where: { userId },
			orderBy: { createdAt: "asc" },
		});

	const listSessions = (userId: number) =>
		client.query.sessions.findMany({
			columns: { createdAt: true, lastVerifiedAt: true, theme: true },
			with: {
				history: {
					columns: { requestedAt: true, method: true, path: true, action: true, status: true, prefetched: true },
					orderBy: { requestedAt: "asc" },
				},
			},
			where: { userId },
			orderBy: { createdAt: "asc" },
		});

	const listReviews = (userId: number) =>
		client.query.reviews.findMany({
			columns: { rating: true, description: true, likeCount: true, createdAt: true, updatedAt: true },
			with: {
				restaurant: { columns: { name: true } },
				pictures: { columns: { url: true } },
			},
			where: { authorId: userId },
			orderBy: { createdAt: "asc" },
		});

	const listLikes = (userId: number) =>
		client.query.likes.findMany({
			columns: { createdAt: true },
			with: {
				review: {
					columns: {},
					with: {
						author: { columns: { username: true } },
						restaurant: { columns: { name: true } },
					},
				},
			},
			where: { userId },
			orderBy: { createdAt: "asc" },
		});

	const listFollowing = (userId: number) =>
		client.query.followers.findMany({
			columns: { createdAt: true },
			with: { following: { columns: { username: true } } },
			where: { followerId: userId },
			orderBy: { createdAt: "asc" },
		});

	const listFollowers = (userId: number) =>
		client.query.followers.findMany({
			columns: { createdAt: true },
			with: { follower: { columns: { username: true } } },
			where: { followingId: userId },
			orderBy: { createdAt: "asc" },
		});

	const listFavorites = (userId: number) => client.query.favorites.findMany(collectedRestaurant(userId));

	const listBucketList = (userId: number) => client.query.bucketList.findMany(collectedRestaurant(userId));

	const listSuggestions = (userId: number) =>
		client.query.restaurants.findMany({
			columns: { name: true, status: true, createdAt: true },
			where: { suggestedBy: userId },
			orderBy: { createdAt: "asc" },
		});

	return {
		async findByUser(userId: number) {
			const user = await findProfile(userId);
			if (!user) return undefined;

			const [accounts, sessions, reviews, likes, following, followers, favorites, bucketList, suggestions] =
				await Promise.all([
					listAccounts(userId),
					listSessions(userId),
					listReviews(userId),
					listLikes(userId),
					listFollowing(userId),
					listFollowers(userId),
					listFavorites(userId),
					listBucketList(userId),
					listSuggestions(userId),
				]);

			const { profilePicture, ...profile } = user;

			return {
				profile: { ...profile, profilePicture: profilePicture?.url ?? null },
				accounts,
				sessions,
				reviews: reviews.map(({ rating, restaurant, pictures, ...review }) => ({
					restaurant: restaurant.name,
					stars: toStars(rating),
					...review,
					pictures: pictures.map((picture) => picture.url),
				})),
				likes: likes.map(({ review, createdAt }) => ({
					author: review.author.username,
					restaurant: review.restaurant.name,
					likedAt: createdAt,
				})),
				following: following.map((follow) => ({ username: follow.following.username, since: follow.createdAt })),
				followers: followers.map((follow) => ({ username: follow.follower.username, since: follow.createdAt })),
				favorites: favorites.map(({ restaurant, createdAt }) => ({ restaurant: restaurant.name, addedAt: createdAt })),
				bucketList: bucketList.map(({ restaurant, createdAt }) => ({ restaurant: restaurant.name, addedAt: createdAt })),
				suggestions: suggestions.map(({ name, status, createdAt }) => ({
					restaurant: name,
					status,
					suggestedAt: createdAt,
				})),
			};
		},
	};
}

export type PersonalData = NonNullable<Awaited<ReturnType<ReturnType<typeof createPersonalDataQueries>["findByUser"]>>>;
