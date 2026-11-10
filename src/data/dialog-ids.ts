// The id of the dialog that asks to confirm the deletion of a review, which the button that opens it refers to.
export function deleteReviewDialogId(reviewId: number) {
	return `delete-review-${reviewId}`;
}
