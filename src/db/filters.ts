import { and, eq, exists, isNull, or, sql, type RelationsFilter, type SQLWrapper } from "drizzle-orm";
import { QueryBuilder } from "drizzle-orm/sqlite-core";
import type { relations } from "@src/db/relations";
import { isInReviewWindow } from "@src/db/review-window";
import * as s from "@src/db/schema";

type Tables = typeof relations;

export type TableName = keyof Tables;
export type Filter<Table extends TableName> = RelationsFilter<Tables[Table], Tables>;

const qb = new QueryBuilder();

export const approvedRestaurant = { status: "approved" } satisfies Filter<"restaurants">;

export const unbannedUser = { bannedAt: { isNull: true } } satisfies Filter<"users">;

export function hasUsername(username: string) {
	return { username: username.toLowerCase() } satisfies Filter<"users">;
}

export function hasEmail(email: string) {
	return { RAW: (user) => sql`lower(${user.email}) = lower(${email})` } satisfies Filter<"users">;
}

// A review that the profile of its author shows. Who may see the profile is decided by the profile.
export const publicReview = {
	restaurant: approvedRestaurant,
	RAW: (review) => isInReviewWindow(review),
} satisfies Filter<"reviews">;

type ReviewColumns = Pick<typeof s.reviews, "id" | "authorId" | "restaurantId" | "createdAt">;

// A public review that is shown to everyone outside the profile of its author: in feeds, on restaurants
// and to like. The reviews of a banned author are left out.
export function isListedReview(review: ReviewColumns) {
	return and(
		isInReviewWindow(review),
		exists(
			qb
				.select({ row: sql`1` })
				.from(s.restaurants)
				.where(and(eq(s.restaurants.id, review.restaurantId), eq(s.restaurants.status, "approved"))),
		),
		exists(
			qb
				.select({ row: sql`1` })
				.from(s.users)
				.where(and(eq(s.users.id, review.authorId), isNull(s.users.bannedAt))),
		),
	)!;
}

export const listedReview = { RAW: (review) => isListedReview(review) } satisfies Filter<"reviews">;

// A notification is hidden while the user who caused it is banned, and shows again when the ban is lifted.
export function isVisibleNotification(notification: Pick<typeof s.notifications, "actorId">) {
	return or(
		isNull(notification.actorId),
		exists(
			qb
				.select({ row: sql`1` })
				.from(s.users)
				.where(and(eq(s.users.id, notification.actorId), isNull(s.users.bannedAt))),
		),
	)!;
}

export const visibleNotification = {
	RAW: (notification) => isVisibleNotification(notification),
} satisfies Filter<"notifications">;

export function containsText(column: SQLWrapper, text: string) {
	const pattern = `%${text.replace(/[\\%_]/g, "\\$&")}%`;
	return sql`${column} like ${pattern} escape '\\'`;
}
