import { and, eq, exists, sql } from "drizzle-orm";
import type { Client } from "@src/db/client";
import { isListedReview, listedReview, publicReview, type Filter } from "@src/db/filters";
import { cursorList } from "@src/db/pagination";
import * as s from "@src/db/schema";
import { asBoolean } from "@src/db/subqueries";
import type { PageItem, PageRequest } from "@src/pagination";

export const feeds = ["following", "everyone"] as const;
export type Feed = (typeof feeds)[number];

const pages = cursorList(s.reviews, ["createdAt", "id"], "desc");

// Everything a review shows wherever it is listed, and what decides what the viewer may do with it.
export function reviewCard(client: Client, viewerId: number) {
	return {
		columns: { id: true, authorId: true, rating: true, description: true, likeCount: true, createdAt: true },
		with: {
			author: { columns: { username: true, fullname: true }, with: { profilePicture: { columns: { url: true } } } },
			restaurant: { columns: { id: true, name: true } },
			pictures: { columns: { id: true, url: true }, orderBy: { id: "asc" } },
		},
		extras: {
			isListed: (review: typeof s.reviews) => asBoolean(isListedReview(review)),
			isLikedByViewer: (review: typeof s.reviews) =>
				asBoolean(
					exists(
						client
							.select({ row: sql`1` })
							.from(s.likes)
							.where(and(eq(s.likes.reviewId, review.id), eq(s.likes.userId, viewerId))),
					),
				),
		},
	} as const;
}

const byFeed = {
	everyone: () => ({}),
	following: (viewerId: number) => ({ author: { followers: { followerId: viewerId } } }),
} satisfies Record<Feed, (viewerId: number) => Filter<"reviews">>;

export function createReviewQueries(client: Client) {
	const list = (viewerId: number, where: Filter<"reviews">, page: PageRequest) =>
		pages(page, (seek) =>
			client.query.reviews.findMany({
				...reviewCard(client, viewerId),
				where: { AND: [where, seek.where] },
				orderBy: seek.orderBy,
				limit: seek.limit,
			}),
		);

	return {
		async findById(id: number, viewerId: number) {
			return client.query.reviews.findFirst({ ...reviewCard(client, viewerId), where: { id } });
		},

		async listFeed(viewerId: number, feed: Feed, page: PageRequest) {
			return list(viewerId, { AND: [listedReview, byFeed[feed](viewerId)] }, page);
		},

		async listByRestaurant(restaurantId: number, viewerId: number, page: PageRequest) {
			return list(viewerId, { AND: [listedReview, { restaurantId }] }, page);
		},

		// Includes the reviews that are not public, so only the author or an admin may see the list.
		async listAllByAuthor(authorId: number, viewerId: number, page: PageRequest) {
			return list(viewerId, { authorId }, page);
		},

		async listPublicByAuthor(authorId: number, viewerId: number, page: PageRequest) {
			return list(viewerId, { ...publicReview, authorId }, page);
		},
	};
}

export type ReviewCard = PageItem<Awaited<ReturnType<ReturnType<typeof createReviewQueries>["listFeed"]>>>;
