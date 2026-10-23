import { count, eq, sql } from "drizzle-orm";
import type { Client } from "@src/db/client";
import { reviewWindowPosition, reviewWindowSize } from "@src/db/review-window";
import * as s from "@src/db/schema";

function inJsonList(column: typeof s.reviews.id | typeof s.restaurants.id, name: string) {
	return sql`${column} in (select value from json_each(${sql.placeholder(name)}))`;
}

export function prepareRefreshLikeCounts(client: Client) {
	return client
		.update(s.reviews)
		.set({
			likeCount: sql`(${client.select({ count: count() }).from(s.likes).where(eq(s.likes.reviewId, s.reviews.id))})`,
		})
		.where(inJsonList(s.reviews.id, "reviewIds"))
		.prepare();
}

export function prepareRefreshRestaurantStats(client: Client) {
	const reviewWindow = sql`select ${s.reviews.authorId} as author_id, ${s.reviews.rating} as rating, ${reviewWindowPosition()} as position from ${s.reviews} where ${s.reviews.restaurantId} = ${s.restaurants.id}`;
	const perAuthorAverages = sql`select avg(rating) as author_avg from (${reviewWindow}) where position <= ${reviewWindowSize} group by author_id`;

	return client
		.update(s.restaurants)
		.set({
			reviewCount: sql`(${client.select({ count: count() }).from(s.reviews).where(eq(s.reviews.restaurantId, s.restaurants.id))})`,
			ratingAvg: sql`coalesce((select avg(author_avg) from (${perAuthorAverages})), 0)`,
		})
		.where(inJsonList(s.restaurants.id, "restaurantIds"))
		.prepare();
}
