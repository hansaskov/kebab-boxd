import { and, avg, eq, inArray, isNull, sql } from "drizzle-orm";
import type { Transaction } from "@src/db/client";
import { isInReviewWindow } from "@src/db/review-window";
import * as s from "@src/db/schema";

export function refreshLikeCounts(tx: Transaction, reviewIds: number[]) {
	tx.update(s.reviews)
		.set({ likeCount: tx.$count(s.likes, eq(s.likes.reviewId, s.reviews.id)) })
		.where(inArray(s.reviews.id, reviewIds))
		.run();
}

// The reviews of banned authors leave the stats until the ban is lifted.
export function refreshRestaurantStats(tx: Transaction, restaurantIds: number[]) {
	const unbannedAuthors = tx.select({ id: s.users.id }).from(s.users).where(isNull(s.users.bannedAt));
	const ofRestaurant = and(eq(s.reviews.restaurantId, s.restaurants.id), inArray(s.reviews.authorId, unbannedAuthors));

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

export function restaurantIdsReviewedBy(tx: Transaction, authorId: number) {
	const reviews = tx.query.reviews.findMany({ columns: { restaurantId: true }, where: { authorId } }).sync();
	return [...new Set(reviews.map((review) => review.restaurantId))];
}
