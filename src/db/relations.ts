import { defineRelations } from "drizzle-orm";
import * as s from "@src/db/schema";

export const relations = defineRelations(s, (r) => ({
  users: {
    sessions: r.many.sessions(),
    accounts: r.many.accounts(),
    reviews: r.many.reviews(),
    following: r.many.followers({
      from: r.users.id,
      to: r.followers.followerId,
    }),
    followers: r.many.followers({
      from: r.users.id,
      to: r.followers.followingId,
    }),
    favorites: r.many.favorites(),
    bucketList: r.many.bucketList(),
    likes: r.many.likes(),
    suggestions: r.many.restaurants({
      from: r.users.id,
      to: r.restaurants.suggestedBy,
    }),
    profilePicture: r.one.pictures({
      from: r.users.profilePictureId,
      to: r.pictures.id,
    }),
  },

  restaurants: {
    reviews: r.many.reviews(),
    favorites: r.many.favorites(),
    bucketList: r.many.bucketList(),
    location: r.one.locations({
      from: r.restaurants.locationId,
      to: r.locations.id,
      optional: false,
    }),
    suggester: r.one.users({
      from: r.restaurants.suggestedBy,
      to: r.users.id,
    }),
  },

  locations: {
    restaurant: r.one.restaurants({
      from: r.locations.id,
      to: r.restaurants.locationId,
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
    likes: r.many.likes(),
  },

  sessions: {
    user: r.one.users({
      from: r.sessions.userId,
      to: r.users.id,
      optional: false,
    }),
    history: r.many.history(),
  },

  history: {
    session: r.one.sessions({
      from: r.history.sessionId,
      to: r.sessions.id,
      optional: false,
    }),
  },

  accounts: {
    user: r.one.users({
      from: r.accounts.userId,
      to: r.users.id,
      optional: false,
    }),
  },

  followers: {
    follower: r.one.users({
      from: r.followers.followerId,
      to: r.users.id,
      optional: false,
    }),
    following: r.one.users({
      from: r.followers.followingId,
      to: r.users.id,
      optional: false,
    }),
  },

  favorites: {
    user: r.one.users({
      from: r.favorites.userId,
      to: r.users.id,
      optional: false,
    }),
    restaurant: r.one.restaurants({
      from: r.favorites.restaurantId,
      to: r.restaurants.id,
      optional: false,
    }),
  },

  bucketList: {
    user: r.one.users({
      from: r.bucketList.userId,
      to: r.users.id,
      optional: false,
    }),
    restaurant: r.one.restaurants({
      from: r.bucketList.restaurantId,
      to: r.restaurants.id,
      optional: false,
    }),
  },

  likes: {
    user: r.one.users({
      from: r.likes.userId,
      to: r.users.id,
      optional: false,
    }),
    review: r.one.reviews({
      from: r.likes.reviewId,
      to: r.reviews.id,
      optional: false,
    }),
  },
}));
