import { ActionError, defineAction } from "astro:actions";
import { authorizeRestaurant, authorizeReview, refusedSinceRequestStarted } from "@src/actions/authorize";
import { restaurantHref, reviewHref } from "@src/hrefs";
import { createReviewSchema, maxPicturesPerReview, reviewTargetSchema, updateReviewSchema } from "@src/validation/review";

function pictureError(result: "invalid-picture" | "too-many-pictures") {
  return new ActionError({
    code: "BAD_REQUEST",
    message:
      result === "invalid-picture"
        ? "One of the files is not a picture. Use JPEG, PNG, WebP, AVIF or GIF."
        : `A review can have at most ${maxPicturesPerReview} pictures.`,
  });
}

export const reviewActions = {
  create: defineAction({
    accept: "form",
    input: createReviewSchema,
    handler: async ({ restaurantId, rating, description, pictures }, context) => {
      const { session } = await authorizeRestaurant(context.locals, restaurantId, "restaurant:review");

      const result = await context.locals.db.mutations.reviews.create(
        session.user.id,
        restaurantId,
        { rating, description: description || null },
        pictures,
      );

      if (result === "refused") throw refusedSinceRequestStarted("this restaurant");
      if (result === "invalid-picture" || result === "too-many-pictures") throw pictureError(result);

      return { redirect: reviewHref(result.id) };
    },
  }),
  update: defineAction({
    accept: "form",
    input: updateReviewSchema,
    handler: async ({ reviewId, rating, description, pictures, removePictureIds }, context) => {
      const { session } = await authorizeReview(context.locals, reviewId, "review:edit");

      const result = await context.locals.db.mutations.reviews.update(session.user.id, reviewId, {
        rating,
        description: description || null,
        addPictures: pictures,
        removePictureIds,
      });

      if (result === "refused") throw refusedSinceRequestStarted("this review");
      if (result === "invalid-picture" || result === "too-many-pictures") throw pictureError(result);

      return { redirect: reviewHref(reviewId) };
    },
  }),
  delete: defineAction({
    accept: "form",
    input: reviewTargetSchema,
    handler: async ({ reviewId }, context) => {
      const { session, review } = await authorizeReview(context.locals, reviewId, "review:delete");

      const result = await context.locals.db.mutations.reviews.delete(session.user.id, reviewId);

      if (result === "refused") throw refusedSinceRequestStarted("this review");

      return { redirect: review.authorId === session.user.id ? "/reviews" : restaurantHref(result.restaurantId) };
    },
  }),
  like: defineAction({
    accept: "form",
    input: reviewTargetSchema,
    handler: async ({ reviewId }, context) => {
      const { session } = await authorizeReview(context.locals, reviewId, "review:like");

      if ((await context.locals.db.mutations.reviews.like(session.user.id, reviewId)) === "refused") {
        throw refusedSinceRequestStarted("this review");
      }
    },
  }),
  unlike: defineAction({
    accept: "form",
    input: reviewTargetSchema,
    handler: async ({ reviewId }, context) => {
      const { session } = await authorizeReview(context.locals, reviewId, "review:unlike");

      if ((await context.locals.db.mutations.reviews.unlike(session.user.id, reviewId)) === "refused") {
        throw refusedSinceRequestStarted("this review");
      }
    },
  }),
};
