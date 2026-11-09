import { and, avg, eq, inArray, max, sql, type SQLWrapper } from "drizzle-orm";
import type { Transaction } from "@src/db/client";
import * as s from "@src/db/schema";
import { isInReviewWindow, isPublicReview, isUnbannedUser } from "@src/db/visibility";

// The LikeCount, ReviewCount and RatingAvg, and the review stats of each user, are cached on their rows. Every write
// that changes what they count calls these in its transaction. Without ids there is nothing to refresh, and no
// statement runs.

// The ids are a list, or a subquery that finds them when the statement runs.
function isEmpty(ids: readonly number[] | SQLWrapper) {
	return Array.isArray(ids) && ids.length === 0;
}

export function refreshLikeCounts(tx: Transaction, reviewIds: number[]) {
	if (isEmpty(reviewIds)) return;
	tx.update(s.reviews)
		.set({ likeCount: tx.$count(s.likes, eq(s.likes.reviewId, s.reviews.id)) })
		.where(inArray(s.reviews.id, reviewIds))
		.run();
}

// The reviews of banned authors leave the stats until the ban is lifted.
export function refreshRestaurantStats(tx: Transaction, restaurantIds: number[] | ReturnType<typeof restaurantsReviewedBy>) {
	if (isEmpty(restaurantIds)) return;
	const ofRestaurant = and(eq(s.reviews.restaurantId, s.restaurants.id), isUnbannedUser(s.reviews.authorId));

	const authorAverages = tx
		.select({ rating: avg(s.reviews.rating).as("author_rating") })
		.from(s.reviews)
		.where(and(ofRestaurant, isInReviewWindow(s.reviews)))
		.groupBy(s.reviews.authorId)
		.as("author_averages");

	tx.update(s.restaurants)
		.set({
			reviewCount: tx.$count(s.reviews, ofRestaurant),
			ratingAvg: sql`coalesce((${tx.select({ rating: avg(authorAverages.rating) }).from(authorAverages)}), 0)`,
		})
		.where(inArray(s.restaurants.id, restaurantIds))
		.run();
}

// How many public Reviews each user has and when they wrote the latest, which change when they write or delete
// one, when a Restaurant they reviewed is approved or no longer is, and when their Profile becomes private or public.
export function refreshAuthorStats(tx: Transaction, userIds: number[] | ReturnType<typeof authorsOfReviewsAt>) {
	if (isEmpty(userIds)) return;
	const publicReviews = sql`(${eq(s.reviews.authorId, s.users.id)} and ${isPublicReview(s.reviews)})`;
	const latest = tx.select({ at: max(s.reviews.createdAt) }).from(s.reviews).where(publicReviews);

	tx.update(s.users)
		.set({
			publicReviewCount: tx.$count(s.reviews, publicReviews),
			latestReviewAt: sql`case when ${s.users.isPrivate} then 0 else coalesce((${latest}), 0) end`,
		})
		.where(inArray(s.users.id, userIds))
		.run();
}

// The users who reviewed the restaurants, as a subquery for `refreshAuthorStats`.
export function authorsOfReviewsAt(tx: Transaction, restaurantIds: number[]) {
	return tx.selectDistinct({ id: s.reviews.authorId }).from(s.reviews).where(inArray(s.reviews.restaurantId, restaurantIds));
}

// The restaurants the author reviewed, as a subquery for `refreshRestaurantStats`.
export function restaurantsReviewedBy(tx: Transaction, authorId: number) {
	return tx.select({ id: s.reviews.restaurantId }).from(s.reviews).where(eq(s.reviews.authorId, authorId));
}
