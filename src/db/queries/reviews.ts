import { and, eq, exists, isNull, sql } from "drizzle-orm";
import type { Client } from "@src/db/client";
import { cursorList, type Filter } from "@src/db/pagination";
import { isInReviewWindow } from "@src/db/review-window";
import * as s from "@src/db/schema";
import type { PageItem, PageRequest } from "@src/pagination";

export const feeds = ["following", "everyone"] as const;
export type Feed = (typeof feeds)[number];

const pages = cursorList("reviews", ["createdAt", "id"], "desc");

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
			// Shown in feeds, on restaurants and to like: in the review window, at an approved restaurant and by an unbanned author.
			isListed: (review: typeof s.reviews) =>
				and(
					isInReviewWindow(review),
					exists(
						client
							.select({ row: sql`1` })
							.from(s.restaurants)
							.where(and(eq(s.restaurants.id, review.restaurantId), eq(s.restaurants.status, "approved"))),
					),
					exists(
						client
							.select({ row: sql`1` })
							.from(s.users)
							.where(and(eq(s.users.id, review.authorId), isNull(s.users.bannedAt))),
					),
				)!.mapWith(Boolean),
			isLikedByViewer: (review: typeof s.reviews) =>
				exists(
					client
						.select({ row: sql`1` })
						.from(s.likes)
						.where(and(eq(s.likes.reviewId, review.id), eq(s.likes.userId, viewerId))),
				).mapWith(Boolean),
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
				...seek(where),
			}),
		);

	return {
		async findById(id: number, viewerId: number) {
			return client.query.reviews.findFirst({ ...reviewCard(client, viewerId), where: { id } });
		},

		async listFeed(viewerId: number, feed: Feed, page: PageRequest) {
			return list(
				viewerId,
				{
					AND: [
						{ restaurant: { status: "approved" }, author: { bannedAt: { isNull: true } }, RAW: (review) => isInReviewWindow(review) },
						byFeed[feed](viewerId),
					],
				},
				page,
			);
		},

		async listByRestaurant(restaurantId: number, viewerId: number, page: PageRequest) {
			return list(
				viewerId,
				{ restaurantId, restaurant: { status: "approved" }, author: { bannedAt: { isNull: true } }, RAW: (review) => isInReviewWindow(review) },
				page,
			);
		},

		// Includes the reviews that are not public, so only the author or an admin may see the list.
		async listAllByAuthor(authorId: number, viewerId: number, page: PageRequest) {
			return list(viewerId, { authorId }, page);
		},

		async listPublicByAuthor(authorId: number, viewerId: number, page: PageRequest) {
			// The profile decides who may see it, so the reviews of a banned author are included.
			return list(viewerId, { authorId, restaurant: { status: "approved" }, RAW: (review) => isInReviewWindow(review) }, page);
		},
	};
}

export type ReviewCard = PageItem<Awaited<ReturnType<ReturnType<typeof createReviewQueries>["listFeed"]>>>;
