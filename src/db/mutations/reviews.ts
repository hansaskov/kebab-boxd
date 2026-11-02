import { and, eq, exists, isNull, sql } from "drizzle-orm";
import type { Client, Transaction } from "@src/db/client";
import { authorizedWrite, isProblem, problem, type Problem } from "@src/db/mutations/authorize";
import { refreshLikeCounts, refreshRestaurantStats } from "@src/db/mutations/cached-stats";
import { notify, withdraw } from "@src/db/mutations/notifications";
import { attachReviewPictures, deletePictures, savingPictures } from "@src/db/mutations/pictures";
import { findTargetRestaurant } from "@src/db/mutations/restaurants";
import { isInReviewWindow } from "@src/db/review-window";
import * as s from "@src/db/schema";
import type { Review } from "@src/db/schema";
import type { PictureStore } from "@src/pictures/store";
import { maxPicturesPerReview } from "@src/validation/review";

export type ReviewContent = Pick<Review, "rating" | "description">;

export interface ReviewChanges extends ReviewContent {
	addPictures: File[];
	removePictureIds: number[];
}

type Picture = { id: number; url: string };

function findTargetReview(tx: Transaction, id: number) {
	return tx.query.reviews
		.findFirst({
			columns: { id: true, authorId: true, restaurantId: true },
			with: { pictures: { columns: { id: true, url: true } } },
			extras: {
				isListed: (review) =>
					and(
						isInReviewWindow(review),
						exists(
							tx
								.select({ row: sql`1` })
								.from(s.restaurants)
								.where(and(eq(s.restaurants.id, review.restaurantId), eq(s.restaurants.status, "approved"))),
						),
						exists(
							tx
								.select({ row: sql`1` })
								.from(s.users)
								.where(and(eq(s.users.id, review.authorId), isNull(s.users.bannedAt))),
						),
					)!.mapWith(Boolean),
			},
			where: { id },
		})
		.sync();
}

export function createReviewMutations(client: Client, pictures: PictureStore) {
	// The files of the pictures go once the rows that point to them are gone.
	async function removingFiles<T extends { removed: Picture[] }>(result: T | Problem) {
		if (!isProblem(result)) await pictures.remove(result.removed.map((picture) => picture.url));
		return result;
	}

	return {
		async create(authorId: number, restaurantId: number, content: ReviewContent, files: File[]) {
			if (files.length > maxPicturesPerReview) return problem("too-many-pictures");

			return savingPictures(pictures, files, "review", (urls) =>
				authorizedWrite(client, authorId, "restaurant:review", (tx) => findTargetRestaurant(tx, restaurantId), (tx) => {
					const review = tx.insert(s.reviews).values({ authorId, restaurantId, ...content }).returning({ id: s.reviews.id }).get();
					attachReviewPictures(tx, review.id, urls);
					refreshRestaurantStats(tx, [restaurantId]);
					return review;
				}),
			);
		},

		async update(actorId: number, id: number, { addPictures, removePictureIds, ...content }: ReviewChanges) {
			const result = await savingPictures(pictures, addPictures, "review", (urls) =>
				authorizedWrite(client, actorId, "review:edit", (tx) => findTargetReview(tx, id), (tx, review) => {
					const removed = review.pictures.filter((picture) => removePictureIds.includes(picture.id));
					if (review.pictures.length - removed.length + urls.length > maxPicturesPerReview) {
						return problem("too-many-pictures");
					}
					tx.update(s.reviews).set(content).where(eq(s.reviews.id, id)).run();
					deletePictures(tx, removed.map((picture) => picture.id));
					attachReviewPictures(tx, id, urls);
					refreshRestaurantStats(tx, [review.restaurantId]);
					return { removed };
				}),
			);
			return removingFiles(result);
		},

		async delete(actorId: number, id: number) {
			const result = authorizedWrite(client, actorId, "review:delete", (tx) => findTargetReview(tx, id), (tx, review) => {
				tx.delete(s.reviews).where(eq(s.reviews.id, id)).run();
				deletePictures(tx, review.pictures.map((picture) => picture.id));
				refreshRestaurantStats(tx, [review.restaurantId]);
				return { ...review, removed: review.pictures };
			});
			return removingFiles(result);
		},

		async like(userId: number, reviewId: number) {
			return authorizedWrite(client, userId, "review:like", (tx) => findTargetReview(tx, reviewId), (tx, review) => {
				const { changes } = tx.insert(s.likes).values({ userId, reviewId }).onConflictDoNothing().run();
				refreshLikeCounts(tx, [reviewId]);
				if (changes > 0) notify(tx, { kind: "like", recipientId: review.authorId, actorId: userId, reviewId });
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
