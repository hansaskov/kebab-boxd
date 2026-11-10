import { defineAction } from "astro:actions";
import { orThrow, requireSession } from "@src/actions/authorize";
import { editReviewHref, profileHref, restaurantHref, reviewHref } from "@src/hrefs";
import { createReviewSchema, removeReviewPictureSchema, reviewTargetSchema, updateReviewSchema } from "@src/validation/review";

function likeAction(write: "like" | "unlike") {
  return defineAction({
    accept: "form",
    input: reviewTargetSchema,
    handler: async ({ reviewId }, { locals }) => {
      orThrow(await locals.db.reviews[write](requireSession(locals).user.id, reviewId));
      // The page after a like points out the Review that was liked.
      return reviewId;
    },
  });
}

export const reviewActions = {
  create: defineAction({
    accept: "form",
    input: createReviewSchema,
    handler: async ({ restaurantId, rating, description, pictures }, { locals }) => {
      const { user } = requireSession(locals);
      const review = orThrow(await locals.db.reviews.create(user.id, restaurantId, { rating, description: description || null }, pictures));
      return { redirect: reviewHref(review.id) };
    },
  }),
  update: defineAction({
    accept: "form",
    input: updateReviewSchema,
    handler: async ({ reviewId, rating, description, pictures }, { locals }) => {
      const { user } = requireSession(locals);
      orThrow(await locals.db.reviews.update(user.id, reviewId, { rating, description: description || null, addPictures: pictures }));
      return { redirect: reviewHref(reviewId) };
    },
  }),
  // The author stays on the edit page, to go on changing the review.
  removePicture: defineAction({
    accept: "form",
    input: removeReviewPictureSchema,
    handler: async ({ reviewId, pictureId }, { locals }) => {
      orThrow(await locals.db.reviews.removePicture(requireSession(locals).user.id, reviewId, pictureId));
      return { redirect: editReviewHref(reviewId) };
    },
  }),
  delete: defineAction({
    accept: "form",
    input: reviewTargetSchema,
    handler: async ({ reviewId }, { locals }) => {
      const { user } = requireSession(locals);
      const review = orThrow(await locals.db.reviews.delete(user.id, reviewId));
      // The author goes back to their reviews on their Profile. An admin goes back to the restaurant.
      return { redirect: review.authorId === user.id ? profileHref(user.username) : restaurantHref(review.restaurantId) };
    },
  }),
  like: likeAction("like"),
  unlike: likeAction("unlike"),
};
