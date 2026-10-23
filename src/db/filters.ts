import { sql, type RelationsFilter, type SQLWrapper } from "drizzle-orm";
import type { relations } from "@src/db/relations";
import { isInReviewWindow } from "@src/db/review-window";

type Tables = typeof relations;

export type TableName = keyof Tables;
export type Filter<Table extends TableName> = RelationsFilter<Tables[Table], Tables>;

export const approvedRestaurant = { status: "approved" } satisfies Filter<"restaurants">;

export const unbannedUser = { bannedAt: { isNull: true } } satisfies Filter<"users">;

export function hasUsername(username: string) {
	return { username: username.toLowerCase() } satisfies Filter<"users">;
}

export function hasEmail(email: string) {
	return { RAW: (user) => sql`lower(${user.email}) = lower(${email})` } satisfies Filter<"users">;
}

export const publicReview = {
	restaurant: approvedRestaurant,
	RAW: (review) => isInReviewWindow(review),
} satisfies Filter<"reviews">;

export function containsText(column: SQLWrapper, text: string) {
	const pattern = `%${text.replace(/[\\%_]/g, "\\$&")}%`;
	return sql`${column} like ${pattern} escape '\\'`;
}
