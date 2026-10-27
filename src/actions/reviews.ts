import { defineAction } from "astro:actions";
import { orThrow, requireSession } from "@src/actions/authorize";
import { restaurantHref, reviewHref } from "@src/hrefs";
import { createReviewSchema, reviewTargetSchema, updateReviewSchema } from "@src/validation/review";

function likeAction(write: "like" | "unlike") {
  return defineAction({
    accept: "form",
    input: reviewTargetSchema,
    handler: async ({ reviewId }, { locals }) => {
      orThrow(await locals.db.mutations.reviews[write](requireSession(locals).user.id, reviewId));
    },
  });
}

export const reviewActions = {
  create: defineAction({
    accept: "form",
    input: createReviewSchema,
    handler: async ({ restaurantId, rating, description, pictures }, { locals }) => {
      const { user } = requireSession(locals);
      const review = orThrow(await locals.db.mutations.reviews.create(user.id, restaurantId, { rating, description: description || null }, pictures));
      return { redirect: reviewHref(review.id) };
    },
  }),
  update: defineAction({
    accept: "form",
    input: updateReviewSchema,
    handler: async ({ reviewId, rating, description, pictures, removePictureIds }, { locals }) => {
      const { user } = requireSession(locals);
      orThrow(
        await locals.db.mutations.reviews.update(user.id, reviewId, {
          rating,
          description: description || null,
          addPictures: pictures,
          removePictureIds,
        }),
      );
      return { redirect: reviewHref(reviewId) };
    },
  }),
  delete: defineAction({
    accept: "form",
    input: reviewTargetSchema,
    handler: async ({ reviewId }, { locals }) => {
      const { user } = requireSession(locals);
      const review = orThrow(await locals.db.mutations.reviews.delete(user.id, reviewId));
      return { redirect: review.authorId === user.id ? "/reviews" : restaurantHref(review.restaurantId) };
    },
  }),
  like: likeAction("like"),
  unlike: likeAction("unlike"),
};
