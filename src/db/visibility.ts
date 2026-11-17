import { and, count, eq, exists, isNull, or, sql, type SQL, type SQLWrapper } from "drizzle-orm";
import { alias, QueryBuilder } from "drizzle-orm/sqlite-core";
import * as s from "@src/db/schema";

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

export function ofViewer(viewerId: number | null, condition: (viewerId: number) => SQL) {
	return (viewerId === null ? sql`0` : condition(viewerId)).mapWith(Boolean);
}

export function isFollowing(followerId: number, followingId: SQLWrapper): SQL {
	return exists(
		qb.select({ row: sql`1` }).from(s.followers).where(and(eq(s.followers.followerId, followerId), eq(s.followers.followingId, followingId))),
	);
}

export function isFollowedBy(viewerId: number | null) {
	return (user: typeof s.users) => ofViewer(viewerId, (id) => isFollowing(id, user.id));
}

export function reviewAuthor(viewerId: number | null) {
	return { columns: { id: true, isPrivate: true }, extras: { isFollowedByViewer: isFollowedBy(viewerId) } } as const;
}

export function sharesReviewsWith(authorId: SQLWrapper, viewerId: number | null): SQL {
	const isPublic = exists(qb.select({ row: sql`1` }).from(s.users).where(and(eq(s.users.id, authorId), eq(s.users.isPrivate, false))));
	if (viewerId === null) return isPublic;
	return sql`(${or(isPublic, eq(authorId, viewerId), isFollowing(viewerId, authorId))})`;
}

export function isApprovedRestaurant(restaurantId: SQLWrapper): SQL {
	return exists(
		qb.select({ row: sql`1` }).from(s.restaurants).where(and(eq(s.restaurants.id, restaurantId), eq(s.restaurants.status, "approved"))),
	);
}

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

export function isPublicReview(review: ReviewColumns): SQL {
	return all(isInReviewWindow(review), isApprovedRestaurant(review.restaurantId));
}

export function isListedReview(review: ReviewColumns): SQL {
	return all(isPublicReview(review), isUnbannedUser(review.authorId));
}

export function isListedReviewFor(review: ReviewColumns, viewerId: number | null): SQL {
	return all(isListedReview(review), sharesReviewsWith(review.authorId, viewerId));
}

export function isVisibleNotification(notification: Pick<typeof s.notifications, "actorId">): SQL {
	return sql`(${or(isNull(notification.actorId), isUnbannedUser(notification.actorId))})`;
}
