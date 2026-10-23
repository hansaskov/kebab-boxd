import { and, count, eq, sql } from "drizzle-orm";
import { alias, QueryBuilder } from "drizzle-orm/sqlite-core";
import * as s from "@src/db/schema";

export const reviewWindowSize = 3;

type ReviewColumns = Pick<typeof s.reviews, "id" | "authorId" | "restaurantId" | "createdAt">;

const newer = alias(s.reviews, "newer");
const qb = new QueryBuilder();

export function isInReviewWindow(review: ReviewColumns) {
	const newerReviews = qb
		.select({ count: count() })
		.from(newer)
		.where(
			and(
				eq(newer.authorId, review.authorId),
				eq(newer.restaurantId, review.restaurantId),
				sql`(${newer.createdAt}, ${newer.id}) > (${review.createdAt}, ${review.id})`,
			),
		);

	return sql`(${newerReviews}) < ${reviewWindowSize}`;
}
