import { and, avg, eq, inArray, max, sql, type SQLWrapper } from "drizzle-orm";
import type { Transaction } from "@src/db/client";
import * as s from "@src/db/schema";
import { isInReviewWindow, isPublicReview, isUnbannedUser } from "@src/db/visibility";

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

export function authorsOfReviewsAt(tx: Transaction, restaurantIds: number[]) {
	return tx.selectDistinct({ id: s.reviews.authorId }).from(s.reviews).where(inArray(s.reviews.restaurantId, restaurantIds));
}

export function restaurantsReviewedBy(tx: Transaction, authorId: number) {
	return tx.select({ id: s.reviews.restaurantId }).from(s.reviews).where(eq(s.reviews.authorId, authorId));
}
