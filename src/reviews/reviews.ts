export const maxPicturesPerReview = 4;

export const feeds = ["following", "everyone"] as const;

export type Feed = (typeof feeds)[number];

export function deleteReviewDialogId(reviewId: number) {
	return `delete-review-${reviewId}`;
}
