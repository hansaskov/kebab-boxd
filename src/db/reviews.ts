import { and, eq, exists, sql } from "drizzle-orm";
import { QueryBuilder } from "drizzle-orm/sqlite-core";
import { authorizedWrite, findTargetRestaurant, findTargetReview } from "@src/db/authorize";
import { refreshLikeCounts, refreshRestaurantStats } from "@src/db/cached-stats";
import type { Client, Transaction } from "@src/db/client";
import { notify, withdraw } from "@src/db/notifications";
import { cursorList, type Filter } from "@src/db/pagination";
import { writeWithPictures, type PictureChanges } from "@src/db/pictures";
import { problem } from "@src/db/problem";
import * as s from "@src/db/schema";
import type { Review } from "@src/db/schema";
import { isListedReview, isPublicReview } from "@src/db/visibility";
import type { PageItem, PageRequest } from "@src/pagination";
import type { PictureStore } from "@src/pictures/store";
import { maxPicturesPerReview } from "@src/validation/review";

export const feeds = ["following", "everyone"] as const;
export type Feed = (typeof feeds)[number];

export type ReviewContent = Pick<Review, "rating" | "description">;

export interface ReviewChanges extends ReviewContent {
	addPictures: File[];
	removePictureIds: number[];
}

const qb = new QueryBuilder();
const pages = cursorList("reviews", ["createdAt", "id"], "desc");

// Everything a review shows wherever it is listed, and what decides what the viewer may do with it.
function reviewCard(viewerId: number) {
	return {
		columns: { id: true, authorId: true, rating: true, description: true, likeCount: true, createdAt: true },
		with: {
			author: { columns: { username: true, fullname: true }, with: { profilePicture: { columns: { url: true } } } },
			restaurant: { columns: { id: true, name: true } },
			pictures: { columns: { id: true, url: true }, orderBy: { id: "asc" } },
		},
		extras: {
			isListed: (review: typeof s.reviews) => isListedReview(review).mapWith(Boolean),
			isLikedByViewer: (review: typeof s.reviews) =>
				exists(
					qb
						.select({ row: sql`1` })
						.from(s.likes)
						.where(and(eq(s.likes.reviewId, review.id), eq(s.likes.userId, viewerId))),
				).mapWith(Boolean),
		},
	} as const;
}

const listed: Filter<"reviews"> = { RAW: (review) => isListedReview(review) };

function attachAddedPictures(tx: Transaction, changes: PictureChanges, reviewId: number) {
	const pictureIds = changes.insertAdded(tx);
	if (pictureIds.length === 0) return;
	tx.insert(s.reviewPictures)
		.values(pictureIds.map((pictureId) => ({ reviewId, pictureId })))
		.run();
}

const byFeed = {
	everyone: () => listed,
	following: (viewerId: number) => ({ ...listed, author: { followers: { followerId: viewerId } } }),
} satisfies Record<Feed, (viewerId: number) => Filter<"reviews">>;

export function createReviews(client: Client, pictures: PictureStore) {
	const list = (viewerId: number, where: Filter<"reviews">, page: PageRequest) =>
		pages(page, (seek) => client.query.reviews.findMany({ ...reviewCard(viewerId), ...seek(where) }));

	return {
		async findById(id: number, viewerId: number) {
			return client.query.reviews.findFirst({ ...reviewCard(viewerId), where: { id } });
		},

		async listFeed(viewerId: number, feed: Feed, page: PageRequest) {
			return list(viewerId, byFeed[feed](viewerId), page);
		},

		async listByRestaurant(restaurantId: number, viewerId: number, page: PageRequest) {
			return list(viewerId, { ...listed, restaurantId }, page);
		},

		// Includes the reviews that are not public, so only the author or an admin may see the list.
		async listAllByAuthor(authorId: number, viewerId: number, page: PageRequest) {
			return list(viewerId, { authorId }, page);
		},

		async listPublicByAuthor(authorId: number, viewerId: number, page: PageRequest) {
			return list(viewerId, { authorId, RAW: (review) => isPublicReview(review) }, page);
		},

		async create(authorId: number, restaurantId: number, content: ReviewContent, files: File[]) {
			if (files.length > maxPicturesPerReview) return problem("too-many-pictures");

			return writeWithPictures(
				pictures,
				(changes) =>
					authorizedWrite(client, authorId, "restaurant:review", (tx) => findTargetRestaurant(tx, restaurantId), (tx) => {
						const review = tx.insert(s.reviews).values({ authorId, restaurantId, ...content }).returning({ id: s.reviews.id }).get();
						attachAddedPictures(tx, changes, review.id);
						refreshRestaurantStats(tx, [restaurantId]);
						return review;
					}),
				{ files, kind: "review" },
			);
		},

		async update(actorId: number, id: number, { addPictures, removePictureIds, ...content }: ReviewChanges) {
			return writeWithPictures(
				pictures,
				(changes) =>
					authorizedWrite(client, actorId, "review:edit", (tx) => findTargetReview(tx, id), (tx, review) => {
						const removed = review.pictures.filter((picture) => removePictureIds.includes(picture.id));
						if (review.pictures.length - removed.length + addPictures.length > maxPicturesPerReview) {
							return problem("too-many-pictures");
						}
						tx.update(s.reviews).set(content).where(eq(s.reviews.id, id)).run();
						changes.remove(tx, removed);
						attachAddedPictures(tx, changes, id);
						refreshRestaurantStats(tx, [review.restaurantId]);
						return "updated" as const;
					}),
				{ files: addPictures, kind: "review" },
			);
		},

		// Returns the review it deleted, so the action knows where to go back to.
		async delete(actorId: number, id: number) {
			return writeWithPictures(pictures, (changes) =>
				authorizedWrite(client, actorId, "review:delete", (tx) => findTargetReview(tx, id), (tx, review) => {
					tx.delete(s.reviews).where(eq(s.reviews.id, id)).run();
					changes.remove(tx, review.pictures);
					refreshRestaurantStats(tx, [review.restaurantId]);
					return { authorId: review.authorId, restaurantId: review.restaurantId };
				}),
			);
		},

		async like(userId: number, reviewId: number) {
			return authorizedWrite(client, userId, "review:like", (tx) => findTargetReview(tx, reviewId), (tx, review) => {
				const inserted = tx.insert(s.likes).values({ userId, reviewId }).onConflictDoNothing().returning({ userId: s.likes.userId }).all();
				refreshLikeCounts(tx, [reviewId]);
				if (inserted.length > 0) notify(tx, { kind: "like", recipientId: review.authorId, actorId: userId, reviewId });
				return "updated" as const;
			});
		},

		async unlike(userId: number, reviewId: number) {
			return authorizedWrite(client, userId, "review:unlike", (tx) => findTargetReview(tx, reviewId), (tx, review) => {
				tx.delete(s.likes).where(and(eq(s.likes.userId, userId), eq(s.likes.reviewId, reviewId))).run();
				refreshLikeCounts(tx, [reviewId]);
				withdraw(tx, { kind: "like", recipientId: review.authorId, actorId: userId, reviewId });
				return "updated" as const;
			});
		},
	};
}

export type ReviewCard = PageItem<Awaited<ReturnType<ReturnType<typeof createReviews>["listFeed"]>>>;
