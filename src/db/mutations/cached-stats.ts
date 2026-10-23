import { and, avg, eq, inArray, sql } from "drizzle-orm";
import type { Transaction } from "@src/db/client";
import { isInReviewWindow } from "@src/db/review-window";
import * as s from "@src/db/schema";

export function refreshLikeCounts(tx: Transaction, reviewIds: number[]) {
	tx.update(s.reviews)
		.set({ likeCount: tx.$count(s.likes, eq(s.likes.reviewId, s.reviews.id)) })
		.where(inArray(s.reviews.id, reviewIds))
		.run();
}

export function refreshRestaurantStats(tx: Transaction, restaurantIds: number[]) {
	const authorAverages = tx
		.select({ rating: avg(s.reviews.rating).as("author_rating") })
		.from(s.reviews)
		.where(and(eq(s.reviews.restaurantId, s.restaurants.id), isInReviewWindow(s.reviews)))
		.groupBy(s.reviews.authorId)
		.as("author_averages");

	tx.update(s.restaurants)
		.set({
			reviewCount: tx.$count(s.reviews, eq(s.reviews.restaurantId, s.restaurants.id)),
			ratingAvg: sql`coalesce((${tx.select({ rating: avg(authorAverages.rating) }).from(authorAverages)}), 0)`,
		})
		.where(inArray(s.restaurants.id, restaurantIds))
		.run();
}
