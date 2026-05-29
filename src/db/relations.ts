import { defineRelations } from "drizzle-orm/relations";
import * as s from "./schema";

export const relations = defineRelations(s, (r) => ({
  users: {
    reviews: r.many.reviews(),
    following: r.many.users({
      from: r.users.id.through(r.followers.followerId), // Might be the other way around.
      to: r.users.id.through(r.followers.followingId),
    }),
    followers: r.many.users({
      from: r.users.id.through(r.followers.followingId), // Might be the other way around.
      to: r.users.id.through(r.followers.followerId),
    }),
    favorites: r.many.restaurants({
      from: r.users.id.through(r.favorites.userId),
      to: r.restaurants.id.through(r.favorites.restaurantId),
      alias: "favorites",
    }),
    bucketList: r.many.restaurants({
      from: r.users.id.through(r.bucketList.userId),
      to: r.restaurants.id.through(r.bucketList.restaurantId),
      alias: "bucketList",
    }),
    likes: r.many.reviews({
      from: r.users.id.through(r.likes.userId),
      to: r.reviews.id.through(r.likes.reviewId),
      alias: "likes",
    }),
    profilePicture: r.one.pictures({
      from: r.users.profilePictureId,
      to: r.pictures.id,
    }),
  },

  restaurants: {
    reviews: r.many.reviews(),
    favorites: r.many.users({
      alias: "favorites",
    }),
    wantsToGo: r.many.users({
      alias: "bucketList",
    }),
    location: r.one.locations({
      from: r.restaurants.locationId,
      to: r.locations.id,
      optional: false,
    }),
  },

  reviews: {
    author: r.one.users({
      from: r.reviews.authorId,
      to: r.users.id,
      optional: false,
    }),
    restaurant: r.one.restaurants({
      from: r.reviews.restaurantId,
      to: r.restaurants.id,
      optional: false,
    }),
    pictures: r.many.pictures({
      from: r.reviews.id.through(r.reviewPictures.reviewId),
      to: r.pictures.id.through(r.reviewPictures.pictureId),
    }),
    likes: r.many.users({
      alias: "likes",
    }),
  },

  sessions: {
    user: r.one.users({
      from: r.sessions.userId,
      to: r.users.id,
      optional: false,
    }),
  },
}));
