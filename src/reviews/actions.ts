import { defineAction } from "astro:actions";
import { orThrow, requireSession } from "@src/actions/authorize";
import { editReviewHref, profileHref, restaurantHref, reviewHref } from "@src/hrefs";
import { z } from "astro/zod";
import { idSchema, picturesSchema } from "@src/actions/schemas";
import { maxPicturesPerReview } from "@src/reviews/reviews";

export const minRating = 2;
export const maxRating = 10;

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

function likeAction(write: "like" | "unlike") {
  return defineAction({
    accept: "form",
    input: reviewTargetSchema,
    handler: async ({ reviewId }, { locals }) => {
      const { db } = locals;
      const { user: actor } = await requireSession(locals);
      orThrow(await db.load(db.reviews[write](actor.id, reviewId)));
      return reviewId;
    },
  });
}

export const reviewActions = {
  create: defineAction({
    accept: "form",
    input: createReviewSchema,
    handler: async ({ restaurantId, rating, description, pictures }, { locals }) => {
      const { db } = locals;
      const { user: actor } = await requireSession(locals);
      const review = orThrow(await db.load(db.reviews.create(actor.id, restaurantId, { rating, description: description || null }, pictures)));
      return { redirect: reviewHref(review.id) };
    },
  }),
  update: defineAction({
    accept: "form",
    input: updateReviewSchema,
    handler: async ({ reviewId, rating, description, pictures }, { locals }) => {
      const { db } = locals;
      const { user: actor } = await requireSession(locals);
      orThrow(await db.load(db.reviews.update(actor.id, reviewId, { rating, description: description || null, addPictures: pictures })));
      return { redirect: reviewHref(reviewId) };
    },
  }),
  removePicture: defineAction({
    accept: "form",
    input: removeReviewPictureSchema,
    handler: async ({ reviewId, pictureId }, { locals }) => {
      const { db } = locals;
      const { user: actor } = await requireSession(locals);
      orThrow(await db.load(db.reviews.removePicture(actor.id, reviewId, pictureId)));
      return { redirect: editReviewHref(reviewId) };
    },
  }),
  delete: defineAction({
    accept: "form",
    input: reviewTargetSchema,
    handler: async ({ reviewId }, { locals }) => {
      const { db } = locals;
      const { user: actor } = await requireSession(locals);
      const review = orThrow(await db.load(db.reviews.delete(actor.id, reviewId)));
      return { redirect: review.authorId === actor.id ? profileHref(actor.username) : restaurantHref(review.restaurantId) };
    },
  }),
  like: likeAction("like"),
  unlike: likeAction("unlike"),
};
