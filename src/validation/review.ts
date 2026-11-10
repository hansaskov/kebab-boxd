import { z } from "astro/zod";
import { idSchema } from "@src/validation/id";
import { picturesSchema } from "@src/validation/picture";

export const minRating = 2;
export const maxRating = 10;
export const maxPicturesPerReview = 4;

export const ratingSchema = z.number().int().min(minRating).max(maxRating);

export const descriptionSchema = z.string().trim().max(2000).nullable();

export const createReviewSchema = z.object({
	restaurantId: idSchema,
	rating: ratingSchema,
	description: descriptionSchema,
	pictures: picturesSchema(maxPicturesPerReview),
});

export const updateReviewSchema = z.object({
	reviewId: idSchema,
	rating: ratingSchema,
	description: descriptionSchema,
	pictures: picturesSchema(maxPicturesPerReview),
});

export const removeReviewPictureSchema = z.object({
	reviewId: idSchema,
	pictureId: idSchema,
});

export const reviewTargetSchema = z.object({
	reviewId: idSchema,
});
