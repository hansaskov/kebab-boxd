import * as p from "drizzle-orm/sqlite-core";
import { pronouns } from "@src/data/pronouns"
import { sql } from "drizzle-orm";
import type { getActionContext } from "astro:actions";

const now = () => sql`(unixepoch())`;

export const users = p.snakeCase.table("users", {
  id: p.int({ mode: "number" }).primaryKey({ autoIncrement: true }),
  fullname: p.text().notNull(),
  username: p.text().notNull(),
  email: p.text().notNull(),
  emailVerified: p.int({mode: "boolean"}).notNull().$default(() => false),
  profilePictureId: p.int({ mode: "number" }).references(() => pictures.id, {onDelete: "set null"}),
  role: p.text({ enum: ["user", "admin"] }).notNull().default("user"),
  bio: p.text(),
  pronoun: p.text({ enum: pronouns }),
  latitude: p.real(),
  longitude: p.real(),
  bannedAt: p.int({ mode: "timestamp" }),
  updatedAt: p.int({ mode: "timestamp" }).notNull().$onUpdate(now),
  createdAt: p.int({ mode: "timestamp" }).notNull().$default(now)
}, (t) => [
  p.index("users_profile_picture_id_idx").on(t.profilePictureId),
  p.index("users_name_idx").on(t.username),
  p.index("users_email_idx").on(t.email),
  p.uniqueIndex("users_username_lower_unique").on(sql`lower(${t.username})`),
  p.uniqueIndex("users_email_unique").on(sql`lower(${t.email})`),
]);

export type User = typeof users.$inferSelect
export const roles = users.role.enumValues
export type Role = User["role"]

export const sessions = p.snakeCase.table("sessions", {
  id: p.text().primaryKey(),
  userId: p.int({ mode: "number" }).notNull().references(() => users.id, {onDelete: "cascade"}),
  secretHash: p.blob({mode: "buffer"}).notNull(),
  lastVerifiedAt: p.int({ mode: "timestamp" }).notNull(),
  theme: p.text({enum: ["light", "dark"]}).notNull().default("light"),
  actionData: p.text({mode: "json"}).$type<ActionData>(),
  updatedAt: p.int({ mode: "timestamp" }).notNull().$onUpdate(now),
  createdAt: p.int({ mode: "timestamp" }).notNull().$default(now)
}, (t) => [
  p.index("sessions_user_id_idx").on(t.userId),
  p.index("sessions_last_verified_at_idx").on(t.lastVerifiedAt),
])

export type Session = typeof sessions.$inferSelect
export type NewSession = typeof sessions.$inferInsert

export const accounts = p.snakeCase.table("accounts", {
  id: p.int({ mode: "number" }).primaryKey({ autoIncrement: true }),
  userId: p.int({ mode: "number" }).notNull().references(() => users.id, {onDelete: "cascade"}),
  accountId: p.text().notNull(),
  providerId: p.text().notNull(),
  updatedAt: p.int({ mode: "timestamp" }).notNull().$onUpdate(now),
  createdAt: p.int({ mode: "timestamp" }).notNull().$default(now)
}, (t) => [
  p.index("accounts_user_id_idx").on(t.userId),
  p.uniqueIndex("accounts_provider_id_account_id_unique").on(t.providerId, t.accountId),
]);

export type Account = typeof accounts.$inferSelect

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
  updatedAt: p.int({ mode: "timestamp" }).notNull().$onUpdate(now),
  createdAt: p.int({ mode: "timestamp" }).notNull().$default(now)
})

export const restaurants = p.snakeCase.table("restaurants", {
  id: p.int({ mode: "number" }).primaryKey({ autoIncrement: true}),
  name: p.text().notNull(),
  locationId: p.int({ mode: "number" }).notNull().references(() => locations.id),
  suggestedBy: p.int({ mode: "number" }).references(() => users.id),
  status: p.text({ enum: ["approved", "pending", "rejected"] }).notNull().default("pending"),
  googlePlaceId: p.text(),
  ratingAvg: p.real().notNull().default(0),
  reviewCount: p.int().notNull().default(0),
  updatedAt: p.int({ mode: "timestamp" }).notNull().$onUpdate(now),
  createdAt: p.int({ mode: "timestamp" }).notNull().$default(now)
}, (t) => [
  p.index("restaurants_location_id_idx").on(t.locationId),
  p.index("restaurants_suggested_by_idx").on(t.suggestedBy),
  p.uniqueIndex("restaurants_google_place_id_unique").on(t.googlePlaceId)
])

export type NewRestaurant = typeof restaurants.$inferInsert

export const reviews = p.snakeCase.table("reviews", {
  id: p.int({ mode: "number" }).primaryKey({ autoIncrement: true }),
  authorId: p.int({ mode: "number" }).notNull().references(() => users.id, {onDelete: "cascade"}),
  restaurantId: p.int({ mode: "number" }).notNull().references(() => restaurants.id, {onDelete: "no action"}),
  rating: p.int({ mode: "number" }).notNull(),
  description: p.text(),
  likeCount: p.int().notNull().default(0),
  updatedAt: p.int({ mode: "timestamp" }).notNull().$onUpdate(now),
  createdAt: p.int({ mode: "timestamp" }).notNull().$default(now)
}, (t) => [
  p.index("reviews_author_id_created_at_id_idx").on(t.authorId, t.createdAt, t.id),
  p.index("reviews_author_id_restaurant_id_created_at_id_idx").on(t.authorId, t.restaurantId, sql`${t.createdAt} desc`, sql`${t.id} desc`),
  p.index("reviews_restaurant_id_idx").on(t.restaurantId),
  p.check("reviews_rating_range", sql`${t.rating} BETWEEN 2 AND 10`)
])

export const pictures = p.snakeCase.table("pictures", {
  id: p.int({ mode: "number" }).primaryKey({ autoIncrement: true }),
  url: p.text().notNull().unique(),
  updatedAt: p.int({ mode: "timestamp" }).notNull().$onUpdate(now),
  createdAt: p.int({ mode: "timestamp" }).notNull().$default(now)
})

export const followers = p.snakeCase.table("followers", {
  followerId: p.int({ mode: "number" }).notNull().references(() => users.id, {onDelete: "cascade"}),
  followingId: p.int({ mode: "number" }).notNull().references(() => users.id, {onDelete: "cascade"}),
  updatedAt: p.int({ mode: "timestamp" }).notNull().$onUpdate(now),
  createdAt: p.int({ mode: "timestamp" }).notNull().$default(now)
}, (t) => [
  p.primaryKey({ columns: [t.followerId, t.followingId] }),
  p.index("followers_following_id_idx").on(t.followingId),
  p.check("followers_no_self_follow", sql`${t.followerId} != ${t.followingId}`),
])

export const favorites = p.snakeCase.table("favorites", {
  userId: p.int({ mode: "number" }).notNull().references(() => users.id, {onDelete: "cascade"}),
  restaurantId: p.int({ mode: "number" }).notNull().references(() => restaurants.id, {onDelete: "cascade"}),
  updatedAt: p.int({ mode: "timestamp" }).notNull().$onUpdate(now),
  createdAt: p.int({ mode: "timestamp" }).notNull().$default(now)
}, (t) => [
  p.primaryKey({ columns: [t.userId, t.restaurantId] }),
  p.index("favorites_user_id_created_at_restaurant_id_idx").on(t.userId, t.createdAt, t.restaurantId),
  p.index("favorites_restaurant_id_idx").on(t.restaurantId),
])

export const likes = p.snakeCase.table("likes", {
  userId: p.int({ mode: "number" }).notNull().references(() => users.id, {onDelete: "cascade"}),
  reviewId: p.int({ mode: "number" }).notNull().references(() => reviews.id, {onDelete: "cascade"}),
  updatedAt: p.int({ mode: "timestamp" }).notNull().$onUpdate(now),
  createdAt: p.int({ mode: "timestamp" }).notNull().$default(now)
}, (t) => [
  p.primaryKey({ columns: [t.userId, t.reviewId] }),
  p.index("likes_review_id_idx").on(t.reviewId),
])

export const bucketList = p.snakeCase.table("bucket_list", {
  userId: p.int({ mode: "number" }).notNull().references(() => users.id, {onDelete: "cascade"}),
  restaurantId: p.int({ mode: "number" }).notNull().references(() => restaurants.id, {onDelete: "cascade"}),
  updatedAt: p.int({ mode: "timestamp" }).notNull().$onUpdate(now),
  createdAt: p.int({ mode: "timestamp" }).notNull().$default(now)
}, (t) => [
  p.primaryKey({ columns: [t.userId, t.restaurantId] }),
  p.index("bucket_list_user_id_created_at_restaurant_id_idx").on(t.userId, t.createdAt, t.restaurantId),
  p.index("bucket_list_restaurant_id_idx").on(t.restaurantId),
])

export const reviewPictures = p.snakeCase.table("review_pictures", {
  reviewId: p.int({ mode: "number" }).notNull().references(() => reviews.id, {onDelete: "cascade"}),
  pictureId: p.int({ mode: "number" }).notNull().references(() => pictures.id, {onDelete: "cascade"}),
  updatedAt: p.int({ mode: "timestamp" }).notNull().$onUpdate(now),
  createdAt: p.int({ mode: "timestamp" }).notNull().$default(now)
}, (t) => [
  p.primaryKey({ columns: [t.pictureId, t.reviewId] }),
  p.index("review_pictures_review_id_idx").on(t.reviewId),
])

export const history = p.snakeCase.table("history", {
  sessionId: p.text().notNull().references(() => sessions.id, {onDelete: "cascade"}),
  requestedAt: p.int({ mode: "timestamp_ms" }).notNull(),
  method: p.text().notNull(),
  route: p.text().notNull(),
  path: p.text().notNull(),
  action: p.text(),
  status: p.int({ mode: "number" }).notNull(),
  prefetched: p.int({ mode: "boolean" }).notNull().default(false),
}, (t) => [
  p.primaryKey({ columns: [t.sessionId, t.requestedAt] }),
  p.index("history_requested_at_idx").on(t.requestedAt),
])

export type NewHistoryEntry = typeof history.$inferInsert

export type SerializedActionResult = ReturnType<ReturnType<typeof getActionContext>["serializeActionResult"]>
export type ActionData = {actionName: string, actionResult: SerializedActionResult}
