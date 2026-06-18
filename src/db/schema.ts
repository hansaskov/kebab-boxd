import * as p from "drizzle-orm/sqlite-core";
import { pronouns } from "@data/pronouns"
import { sql } from "drizzle-orm";

export const users = p.snakeCase.table("users", {
  id: p.int({ mode: "number" }).primaryKey({ autoIncrement: true }),
  username: p.text().notNull(),
  email: p.text().notNull().unique(),
  googleId: p.text().notNull().unique(),
  profilePictureId: p.int({ mode: "number" }).references(() => pictures.id, {onDelete: "set null"}),
  isAdmin: p.int({ mode: "boolean" }).notNull().default(false),
  bio: p.text(),
  pronoun: p.text({ enum: pronouns }),
  latitude: p.real(),
  longitude: p.real(),
  updatedAt: p.int({ mode: "timestamp" }).notNull().$onUpdate(() => new Date),
  createdAt: p.int({ mode: "timestamp" }).notNull().$default(() => new Date)
}, (t) => [
  p.index("users_profile_picture_id_idx").on(t.profilePictureId),
  p.index("users_name_idx").on(t.username),
  p.index("users_email_idx").on(t.email),
  p.index("users_google_id_idx").on(t.googleId)
]);


export const locations = p.snakeCase.table("locations", {
  id: p.int({ mode: "number" }).primaryKey({ autoIncrement: true }),
  addressLine1: p.text(),
  addressLine2: p.text(),
  city: p.text(),
  postalCode: p.text(),
  region: p.text(),
  country: p.text(),
  latitude: p.real().notNull(),
  longitude: p.real().notNull(),
  updatedAt: p.int({ mode: "timestamp" }).notNull().$onUpdate(() => new Date),
  createdAt: p.int({ mode: "timestamp" }).notNull().$default(() => new Date)
})

export const restaurants = p.snakeCase.table("restaurants", {
  id: p.int({ mode: "number" }).primaryKey({ autoIncrement: true}),
  name: p.text().notNull(),
  locationId: p.int({ mode: "number" }).notNull().references(() => locations.id),
  suggestedBy: p.int({ mode: "number" }).references(() => users.id),
  status: p.text({ enum: ["approved", "pending", "rejected"] }).notNull().default("pending"),
  googlePlaceId: p.text().unique(),
  ratingAvg: p.real().notNull().default(0), // Derived
  reviewCount: p.int().notNull().default(0), // Derived
  updatedAt: p.int({ mode: "timestamp" }).notNull().$onUpdate(() => new Date),
  createdAt: p.int({ mode: "timestamp" }).notNull().$default(() => new Date)
}, (t) => [
  p.index("restaurants_location_id_idx").on(t.locationId),
  p.index("restaurants_suggested_by_idx").on(t.suggestedBy),
  p.index("restaurants_google_place_id_idx").on(t.googlePlaceId)
])

export const reviews = p.snakeCase.table("reviews", {
  id: p.int({ mode: "number" }).primaryKey({ autoIncrement: true }),
  authorId: p.int({ mode: "number" }).notNull().references(() => users.id, {onDelete: "cascade"}),
  restaurantId: p.int({ mode: "number" }).notNull().references(() => restaurants.id, {onDelete: "no action"}),
  rating: p.int({ mode: "number" }).notNull(),
  description: p.text(),
  likeCount: p.int().notNull().default(0), // Derived
  updatedAt: p.int({ mode: "timestamp" }).notNull().$onUpdate(() => new Date),
  createdAt: p.int({ mode: "timestamp" }).notNull().$default(() => new Date)
}, (t) => [
  p.index("reviews_author_id_idx").on(t.authorId),
  p.index("reviews_restaurant_id_idx").on(t.restaurantId),
  p.check("reviews_rating_range", sql`${t.rating} BETWEEN 1 AND 10`)
])

export const pictures = p.snakeCase.table("pictures", {
  id: p.int({ mode: "number" }).primaryKey({ autoIncrement: true }),
  url: p.text().notNull().unique(),
  updatedAt: p.int({ mode: "timestamp" }).notNull().$onUpdate(() => new Date),
  createdAt: p.int({ mode: "timestamp" }).notNull().$default(() => new Date)
})

export const followers = p.snakeCase.table("followers", {
  followerId: p.int({ mode: "number" }).notNull().references(() => users.id, {onDelete: "cascade"}),
  followingId: p.int({ mode: "number" }).notNull().references(() => users.id, {onDelete: "cascade"}),
  updatedAt: p.int({ mode: "timestamp" }).notNull().$onUpdate(() => new Date),
  createdAt: p.int({ mode: "timestamp" }).notNull().$default(() => new Date)
}, (t) => [
  p.primaryKey({ columns: [t.followerId, t.followingId] }),
  p.index("followers_follower_id_idx").on(t.followerId),
  p.index("followers_following_id_idx").on(t.followingId),
  p.index("followers_follower_id_following_id_idx").on(t.followerId, t.followingId),
  p.check("followers_no_self_follow", sql`${t.followerId} != ${t.followingId}`),
])

export const favorites = p.snakeCase.table("favorites", {
  userId: p.int({ mode: "number" }).notNull().references(() => users.id, {onDelete: "cascade"}),
  restaurantId: p.int({ mode: "number" }).notNull().references(() => restaurants.id, {onDelete: "cascade"}),
  updatedAt: p.int({ mode: "timestamp" }).notNull().$onUpdate(() => new Date),
  createdAt: p.int({ mode: "timestamp" }).notNull().$default(() => new Date)
}, (t) => [
  p.primaryKey({ columns: [t.userId, t.restaurantId] }),
  p.index("favorites_user_id_idx").on(t.userId),
  p.index("favorites_restaurant_id_idx").on(t.restaurantId),
  p.index("favorites_user_id_restaurant_id_idx").on(t.userId, t.restaurantId),
])

export const likes = p.snakeCase.table("likes", {
  userId: p.int({ mode: "number" }).notNull().references(() => users.id, {onDelete: "cascade"}),
  reviewId: p.int({ mode: "number" }).notNull().references(() => reviews.id, {onDelete: "cascade"}),
  updatedAt: p.int({ mode: "timestamp" }).notNull().$onUpdate(() => new Date),
  createdAt: p.int({ mode: "timestamp" }).notNull().$default(() => new Date)
}, (t) => [
  p.primaryKey({ columns: [t.userId, t.reviewId] }),
  p.index("likes_user_id_idx").on(t.userId),
  p.index("likes_review_id_idx").on(t.reviewId),
  p.index("likes_user_id_review_id_idx").on(t.userId, t.reviewId),
])

export const bucketList = p.snakeCase.table("bucket_list", {
  userId: p.int({ mode: "number" }).notNull().references(() => users.id, {onDelete: "cascade"}),
  restaurantId: p.int({ mode: "number" }).notNull().references(() => restaurants.id, {onDelete: "cascade"}),
  updatedAt: p.int({ mode: "timestamp" }).notNull().$onUpdate(() => new Date),
  createdAt: p.int({ mode: "timestamp" }).notNull().$default(() => new Date)
}, (t) => [
  p.primaryKey({ columns: [t.userId, t.restaurantId] }),
  p.index("bucket_list_user_id_idx").on(t.userId),
  p.index("bucket_list_restaurant_id_idx").on(t.restaurantId),
  p.index("bucket_list_user_id_restaurant_id_idx").on(t.userId, t.restaurantId),
])

export const reviewPictures = p.snakeCase.table("review_pictures", {
  reviewId: p.int({ mode: "number" }).notNull().references(() => reviews.id, {onDelete: "cascade"}),
  pictureId: p.int({ mode: "number" }).notNull().references(() => pictures.id, {onDelete: "cascade"}),
  updatedAt: p.int({ mode: "timestamp" }).notNull().$onUpdate(() => new Date),
  createdAt: p.int({ mode: "timestamp" }).notNull().$default(() => new Date)
}, (t) => [
  p.primaryKey({ columns: [t.pictureId, t.reviewId] }),
  p.index("review_pictures_review_id_idx").on(t.reviewId),
  p.index("review_pictures_picture_id_idx").on(t.pictureId),
  p.index("review_pictures_picture_id_review_id_idx").on(t.pictureId, t.reviewId),
])

export const sessions = p.snakeCase.table("sessions", {
  id: p.text().primaryKey(),
  userId: p.int({ mode: "number" }).notNull().references(() => users.id, {onDelete: "cascade"}),
  secretHash: p.blob({mode: "buffer"}).notNull(),
  lastVerifiedAt: p.int({ mode: "timestamp" }).notNull(),
  theme: p.text({enum: ["light", "dark"]}).default("light").notNull(),
  updatedAt: p.int({ mode: "timestamp" }).notNull().$onUpdate(() => new Date),
  createdAt: p.int({ mode: "timestamp" }).notNull().$default(() => new Date)
}, (t) => [
  p.index("sessions_user_id_idx").on(t.userId)
])