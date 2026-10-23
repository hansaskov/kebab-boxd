import { sql } from "drizzle-orm";
import * as s from "@src/db/schema";

export const reviewWindowSize = 3;

export function reviewWindowPosition() {
	return sql<number>`row_number() over (partition by ${s.reviews.authorId}, ${s.reviews.restaurantId} order by ${s.reviews.createdAt} desc, ${s.reviews.id} desc)`;
}
