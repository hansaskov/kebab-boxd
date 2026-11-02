import { and, count, eq, exists, isNull, or, sql, type SQL, type SQLWrapper } from "drizzle-orm";
import { alias, QueryBuilder } from "drizzle-orm/sqlite-core";
import * as s from "@src/db/schema";

// What other users see. CONTEXT.md defines each rule; this is the only place that writes them as SQL, so every
// list, count, cached stat and permission hides the same rows.

const reviewWindowSize = 3;

const qb = new QueryBuilder();
const newer = alias(s.reviews, "newer");

type ReviewColumns = Pick<typeof s.reviews, "id" | "authorId" | "restaurantId" | "createdAt">;

function all(...conditions: SQL[]): SQL {
	return sql`(${sql.join(conditions, sql` and `)})`;
}

export function isUnbannedUser(userId: SQLWrapper): SQL {
	return exists(qb.select({ row: sql`1` }).from(s.users).where(and(eq(s.users.id, userId), isNull(s.users.bannedAt))));
}

export function isApprovedRestaurant(restaurantId: SQLWrapper): SQL {
	return exists(
		qb.select({ row: sql`1` }).from(s.restaurants).where(and(eq(s.restaurants.id, restaurantId), eq(s.restaurants.status, "approved"))),
	);
}

// One of the newest reviews of its author for its restaurant.
export function isInReviewWindow(review: ReviewColumns): SQL {
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

// Shown on the Profile of its author, which decides itself who may see a banned author.
export function isPublicReview(review: ReviewColumns): SQL {
	return all(isInReviewWindow(review), isApprovedRestaurant(review.restaurantId));
}

// Shown in Feeds and on its Restaurant, and may be liked.
export function isListedReview(review: ReviewColumns): SQL {
	return all(isPublicReview(review), isUnbannedUser(review.authorId));
}

// Hidden while the user who caused it is banned, and shown again when the ban is lifted.
export function isVisibleNotification(notification: Pick<typeof s.notifications, "actorId">): SQL {
	return sql`(${or(isNull(notification.actorId), isUnbannedUser(notification.actorId))})`;
}
