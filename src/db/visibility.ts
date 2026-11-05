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

// A condition on the viewer, as an extra of a query. A Visitor has nothing of their own, so it is false for them.
export function ofViewer(viewerId: number | null, condition: (viewerId: number) => SQL) {
	return (viewerId === null ? sql`0` : condition(viewerId)).mapWith(Boolean);
}

export function isFollowing(followerId: number, followingId: SQLWrapper): SQL {
	return exists(
		qb.select({ row: sql`1` }).from(s.followers).where(and(eq(s.followers.followerId, followerId), eq(s.followers.followingId, followingId))),
	);
}

// Whether the viewer follows the user, as an extra of a query on users. A Visitor follows no one.
export function isFollowedBy(viewerId: number | null) {
	return (user: typeof s.users) => ofViewer(viewerId, (id) => isFollowing(id, user.id));
}

// The author of a Review as the permissions need them, as a relation of a query on reviews.
export function reviewAuthor(viewerId: number | null) {
	return { columns: { id: true, isPrivate: true }, extras: { isFollowedByViewer: isFollowedBy(viewerId) } } as const;
}

// The author shares their Reviews with the viewer, who is null for a Visitor: the Profile of the author is public,
// or the viewer is the author or follows them. The permissions write the same rule for one Review.
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

// Listed, and shared by its author with the viewer, who is null for a Visitor.
export function isListedReviewFor(review: ReviewColumns, viewerId: number | null): SQL {
	return all(isListedReview(review), sharesReviewsWith(review.authorId, viewerId));
}

// Hidden while the user who caused it is banned, and shown again when the ban is lifted.
export function isVisibleNotification(notification: Pick<typeof s.notifications, "actorId">): SQL {
	return sql`(${or(isNull(notification.actorId), isUnbannedUser(notification.actorId))})`;
}
