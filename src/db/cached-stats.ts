import { and, avg, eq, inArray, sql } from "drizzle-orm";
import type { Transaction } from "@src/db/client";
import * as s from "@src/db/schema";
import { isInReviewWindow, isUnbannedUser } from "@src/db/visibility";

// The LikeCount, ReviewCount and RatingAvg are cached on their rows. Every write that changes what they count
// calls these in its transaction.

export function refreshLikeCounts(tx: Transaction, reviewIds: number[]) {
	tx.update(s.reviews)
		.set({ likeCount: tx.$count(s.likes, eq(s.likes.reviewId, s.reviews.id)) })
		.where(inArray(s.reviews.id, reviewIds))
		.run();
}

// The reviews of banned authors leave the stats until the ban is lifted.
export function refreshRestaurantStats(tx: Transaction, restaurantIds: number[] | ReturnType<typeof restaurantsReviewedBy>) {
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

// The restaurants the author reviewed, as a subquery for `refreshRestaurantStats`.
export function restaurantsReviewedBy(tx: Transaction, authorId: number) {
	return tx.select({ id: s.reviews.restaurantId }).from(s.reviews).where(eq(s.reviews.authorId, authorId));
}
