import { and, eq, exists, sql } from "drizzle-orm";
import { QueryBuilder } from "drizzle-orm/sqlite-core";
import { authorizedWrite, findTargetRestaurant, findTargetReview } from "@src/db/authorize";
import { refreshAuthorStats, refreshLikeCounts, refreshRestaurantStats } from "@src/db/cached-stats";
import type { Client, Transaction } from "@src/db/client";
import { notify, withdraw } from "@src/db/notifications";
import { cursorList, type Filter } from "@src/db/pagination";
import { authorizedWriteWithPictures, type PictureChanges } from "@src/db/pictures";
import { problem } from "@src/db/problem";
import * as s from "@src/db/schema";
import type { Review } from "@src/db/schema";
import { isListedReview, isListedReviewFor, isPublicReview, ofViewer, reviewAuthor } from "@src/db/visibility";
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

// Everything a review shows wherever it is listed, and what decides what the viewer, null for a Visitor, may do with it.
function reviewCard(viewerId: number | null) {
	const author = reviewAuthor(viewerId);
	return {
		columns: { id: true, authorId: true, rating: true, description: true, likeCount: true, createdAt: true },
		with: {
			author: {
				...author,
				columns: { ...author.columns, username: true, fullname: true },
				with: { profilePicture: { columns: { url: true } } },
			},
			restaurant: { columns: { id: true, name: true } },
			pictures: { columns: { id: true, url: true }, orderBy: { id: "asc" } },
		},
		extras: {
			isListed: (review: typeof s.reviews) => isListedReview(review).mapWith(Boolean),
			isLikedByViewer: (review: typeof s.reviews) =>
				ofViewer(viewerId, (id) =>
					exists(
						qb
							.select({ row: sql`1` })
							.from(s.likes)
							.where(and(eq(s.likes.reviewId, review.id), eq(s.likes.userId, id))),
					),
				),
		},
	} as const;
}

// The Reviews listed to the viewer, who is null for a Visitor.
function listedTo(viewerId: number | null): Filter<"reviews"> {
	return { RAW: (review) => isListedReviewFor(review, viewerId) };
}

function attachAddedPictures(tx: Transaction, changes: PictureChanges, reviewId: number) {
	const pictureIds = changes.insertAdded(tx);
	if (pictureIds.length === 0) return;
	tx.insert(s.reviewPictures)
		.values(pictureIds.map((pictureId) => ({ reviewId, pictureId })))
		.run();
}

export function createReviews(client: Client, pictures: PictureStore) {
	const list = (viewerId: number | null, where: Filter<"reviews">, page: PageRequest) =>
		pages(page, (seek) => client.query.reviews.findMany({ ...reviewCard(viewerId), ...seek(where) }));

	return {
		// Whether the viewer may see it is for the permission review:view to decide.
		async findById(id: number, viewerId: number | null) {
			return client.query.reviews.findFirst({ ...reviewCard(viewerId), where: { id } });
		},

		// The Feed called Everyone, which a Visitor sees too.
		async listEveryone(viewerId: number | null, page: PageRequest) {
			return list(viewerId, listedTo(viewerId), page);
		},

		// The Feed of the people the viewer follows.
		async listFollowed(viewerId: number, page: PageRequest) {
			return list(viewerId, { ...listedTo(viewerId), author: { followers: { followerId: viewerId } } }, page);
		},

		async listByRestaurant(restaurantId: number, viewerId: number | null, page: PageRequest) {
			return list(viewerId, { ...listedTo(viewerId), restaurantId }, page);
		},

		// Includes the reviews that are not public, so it is only for a viewer with the permission user:view-hidden-reviews.
		async listAllByAuthor(authorId: number, viewerId: number, page: PageRequest) {
			return list(viewerId, { authorId }, page);
		},

		// Only for a viewer with the permission user:view-reviews on the author.
		async listPublicByAuthor(authorId: number, viewerId: number | null, page: PageRequest) {
			return list(viewerId, { authorId, RAW: (review) => isPublicReview(review) }, page);
		},

		async create(authorId: number, restaurantId: number, content: ReviewContent, files: File[]) {
			if (files.length > maxPicturesPerReview) return problem("too-many-pictures");

			return authorizedWriteWithPictures(
				client,
				pictures,
				authorId,
				"restaurant:review",
				(tx) => findTargetRestaurant(tx, restaurantId),
				(tx, _restaurant, changes) => {
					const review = tx.insert(s.reviews).values({ authorId, restaurantId, ...content }).returning({ id: s.reviews.id }).get();
					attachAddedPictures(tx, changes, review.id);
					refreshRestaurantStats(tx, [restaurantId]);
					refreshAuthorStats(tx, [authorId]);
					return review;
				},
				{ files, kind: "review" },
			);
		},

		async update(actorId: number, id: number, { addPictures, removePictureIds, ...content }: ReviewChanges) {
			return authorizedWriteWithPictures(
				client,
				pictures,
				actorId,
				"review:edit",
				(tx) => findTargetReview(tx, id, actorId),
				(tx, review, changes) => {
					const removed = review.pictures.filter((picture) => removePictureIds.includes(picture.id));
					if (review.pictures.length - removed.length + addPictures.length > maxPicturesPerReview) {
						return problem("too-many-pictures");
					}
					tx.update(s.reviews).set(content).where(eq(s.reviews.id, id)).run();
					changes.remove(tx, removed);
					attachAddedPictures(tx, changes, id);
					refreshRestaurantStats(tx, [review.restaurantId]);
					return "updated" as const;
				},
				{ files: addPictures, kind: "review" },
			);
		},

		// Returns the review it deleted, so the action knows where to go back to.
		async delete(actorId: number, id: number) {
			return authorizedWriteWithPictures(client, pictures, actorId, "review:delete", (tx) => findTargetReview(tx, id, actorId), (tx, review, changes) => {
				tx.delete(s.reviews).where(eq(s.reviews.id, id)).run();
				changes.remove(tx, review.pictures);
				refreshRestaurantStats(tx, [review.restaurantId]);
				refreshAuthorStats(tx, [review.authorId]);
				return { authorId: review.authorId, restaurantId: review.restaurantId };
			});
		},

		async like(userId: number, reviewId: number) {
			return authorizedWrite(client, userId, "review:like", (tx) => findTargetReview(tx, reviewId, userId), (tx, review) => {
				const inserted = tx.insert(s.likes).values({ userId, reviewId }).onConflictDoNothing().returning({ userId: s.likes.userId }).all();
				refreshLikeCounts(tx, [reviewId]);
				if (inserted.length > 0) notify(tx, { kind: "like", recipientId: review.authorId, actorId: userId, reviewId });
				return "updated" as const;
			});
		},

		async unlike(userId: number, reviewId: number) {
			return authorizedWrite(client, userId, "review:unlike", (tx) => findTargetReview(tx, reviewId, userId), (tx, review) => {
				tx.delete(s.likes).where(and(eq(s.likes.userId, userId), eq(s.likes.reviewId, reviewId))).run();
				refreshLikeCounts(tx, [reviewId]);
				withdraw(tx, { kind: "like", recipientId: review.authorId, actorId: userId, reviewId });
				return "updated" as const;
			});
		},
	};
}

export type ReviewCard = PageItem<Awaited<ReturnType<ReturnType<typeof createReviews>["listEveryone"]>>>;
