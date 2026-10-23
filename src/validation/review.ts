import { z } from "astro/zod";
import { idSchema } from "@src/validation/id";

export const minRating = 2;
export const maxRating = 10;
export const maxPictureBytes = 10 * 1024 * 1024;
export const maxPicturesPerReview = 4;

export const ratingSchema = z.number().int().min(minRating).max(maxRating);

export const descriptionSchema = z.string().trim().max(2000).nullable();

const pictureSchema = z.instanceof(File).refine((file) => file.size <= maxPictureBytes, "A picture can be at most 10 MB.");

// A file input that the user left empty still sends a file, without a name or bytes.
export function picturesSchema(max: number) {
	return z
		.array(z.instanceof(File))
		.transform((files) => files.filter((file) => file.size > 0))
		.pipe(z.array(pictureSchema).max(max, `Add at most ${max} pictures.`));
}

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
	removePictureIds: z.array(idSchema),
});

export const reviewTargetSchema = z.object({
	reviewId: idSchema,
});
