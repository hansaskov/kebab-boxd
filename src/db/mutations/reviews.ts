import { and, eq } from "drizzle-orm";
import type { Client, Transaction } from "@src/db/client";
import { isListedReview } from "@src/db/filters";
import { authorizedWrite } from "@src/db/mutations/authorized-write";
import { refreshLikeCounts, refreshRestaurantStats } from "@src/db/mutations/cached-stats";
import { notify, withdraw } from "@src/db/mutations/notifications";
import { attachReviewPictures, deletePictures, savingPictures } from "@src/db/mutations/pictures";
import { findTargetRestaurant } from "@src/db/mutations/restaurants";
import * as s from "@src/db/schema";
import type { Review } from "@src/db/schema";
import { asBoolean } from "@src/db/subqueries";
import type { PictureStore } from "@src/pictures/store";
import { maxPicturesPerReview } from "@src/validation/review";

export type ReviewContent = Pick<Review, "rating" | "description">;

export interface ReviewChanges extends ReviewContent {
	addPictures: File[];
	removePictureIds: number[];
}

function findTargetReview(tx: Transaction, id: number) {
	return tx.query.reviews
		.findFirst({
			columns: { id: true, authorId: true, restaurantId: true },
			with: { pictures: { columns: { id: true, url: true } } },
			extras: { isListed: (review) => asBoolean(isListedReview(review)) },
			where: { id },
		})
		.sync();
}

function isWritten<T>(result: T | "refused" | "too-many-pictures"): result is T {
	return result !== "refused" && result !== "too-many-pictures";
}

export function createReviewMutations(client: Client, pictures: PictureStore) {
	return {
		async create(authorId: number, restaurantId: number, content: ReviewContent, files: File[]) {
			if (files.length > maxPicturesPerReview) return "too-many-pictures";

			return savingPictures(
				pictures,
				files,
				"review",
				(urls) =>
					authorizedWrite(client, authorId, "restaurant:review", (tx) => findTargetRestaurant(tx, restaurantId), (tx) => {
						const review = tx
							.insert(s.reviews)
							.values({ authorId, restaurantId, ...content })
							.returning({ id: s.reviews.id })
							.get();
						attachReviewPictures(tx, review.id, urls);
						refreshRestaurantStats(tx, [restaurantId]);
						return review;
					}),
				isWritten,
			);
		},

		async update(actorId: number, id: number, { addPictures, removePictureIds, ...content }: ReviewChanges) {
			const result = await savingPictures(
				pictures,
				addPictures,
				"review",
				(urls) =>
					authorizedWrite(client, actorId, "review:edit", (tx) => findTargetReview(tx, id), (tx, review) => {
						const removed = review.pictures.filter((picture) => removePictureIds.includes(picture.id));
						if (review.pictures.length - removed.length + urls.length > maxPicturesPerReview) {
							return "too-many-pictures" as const;
						}
						tx.update(s.reviews).set(content).where(eq(s.reviews.id, id)).run();
						deletePictures(tx, removed.map((picture) => picture.id));
						attachReviewPictures(tx, id, urls);
						refreshRestaurantStats(tx, [review.restaurantId]);
						return { removedUrls: removed.map((picture) => picture.url) };
					}),
				isWritten,
			);
			if (result === "refused" || result === "too-many-pictures" || result === "invalid-picture") return result;
			await pictures.remove(result.removedUrls);
			return "updated";
		},

		async delete(actorId: number, id: number) {
			const result = authorizedWrite(client, actorId, "review:delete", (tx) => findTargetReview(tx, id), (tx, review) => {
				tx.delete(s.reviews).where(eq(s.reviews.id, id)).run();
				deletePictures(tx, review.pictures.map((picture) => picture.id));
				refreshRestaurantStats(tx, [review.restaurantId]);
				return review;
			});
			if (result === "refused") return result;
			await pictures.remove(result.pictures.map((picture) => picture.url));
			return { restaurantId: result.restaurantId };
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
				tx.delete(s.likes)
					.where(and(eq(s.likes.userId, userId), eq(s.likes.reviewId, reviewId)))
					.run();
				refreshLikeCounts(tx, [reviewId]);
				withdraw(tx, { kind: "like", recipientId: review.authorId, actorId: userId, reviewId });
				return "updated" as const;
			});
		},
	};
}
