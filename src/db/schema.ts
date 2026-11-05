import * as p from "drizzle-orm/sqlite-core";
import { pronouns } from "@src/data/pronouns"
import { sql } from "drizzle-orm";
import type { ActionOutcome } from "@src/actions/outcome";

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
  followNotifications: p.int({ mode: "boolean" }).notNull().default(true),
  likeNotifications: p.int({ mode: "boolean" }).notNull().default(true),
  suggestionNotifications: p.int({ mode: "boolean" }).notNull().default(true),
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
  actionData: p.text({mode: "json"}).$type<ActionOutcome>(),
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
}, (t) => [
  p.index("locations_latitude_longitude_idx").on(t.latitude, t.longitude),
])

export type Location = typeof locations.$inferSelect
export type NewLocation = typeof locations.$inferInsert

export const restaurants = p.snakeCase.table("restaurants", {
  id: p.int({ mode: "number" }).primaryKey({ autoIncrement: true}),
  name: p.text().notNull(),
  locationId: p.int({ mode: "number" }).notNull().references(() => locations.id),
  suggestedBy: p.int({ mode: "number" }).references(() => users.id),
  status: p.text({ enum: ["approved", "pending", "rejected"] }).notNull().default("pending"),
  googleMapsId: p.text(),
  // The OpenStreetMap element of a restaurant a CitySearch found, such as node/123.
  osmId: p.text(),
  citySearchId: p.int({ mode: "number" }).references(() => citySearches.id, {onDelete: "set null"}),
  ratingAvg: p.real().notNull().default(0),
  reviewCount: p.int().notNull().default(0),
  updatedAt: p.int({ mode: "timestamp" }).notNull().$onUpdate(now),
  createdAt: p.int({ mode: "timestamp" }).notNull().$default(now)
}, (t) => [
  p.index("restaurants_location_id_idx").on(t.locationId),
  p.index("restaurants_suggested_by_idx").on(t.suggestedBy),
  p.index("restaurants_status_id_idx").on(t.status, t.id),
  p.index("restaurants_status_rating_avg_id_idx").on(t.status, t.ratingAvg, t.id),
  p.index("restaurants_status_review_count_id_idx").on(t.status, t.reviewCount, t.id),
  // Not unique: a rejected restaurant may be suggested again.
  p.index("restaurants_google_maps_id_idx").on(t.googleMapsId),
  p.index("restaurants_osm_id_idx").on(t.osmId),
  p.index("restaurants_city_search_id_status_id_idx").on(t.citySearchId, t.status, t.id),
])

export type Restaurant = typeof restaurants.$inferSelect
export type NewRestaurant = typeof restaurants.$inferInsert
export const restaurantStatuses = restaurants.status.enumValues
export type RestaurantStatus = Restaurant["status"]

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
  p.index("reviews_restaurant_id_created_at_id_idx").on(t.restaurantId, t.createdAt, t.id),
  p.index("reviews_created_at_id_idx").on(t.createdAt, t.id),
  p.check("reviews_rating_range", sql`${t.rating} BETWEEN 2 AND 10`)
])

export type Review = typeof reviews.$inferSelect

// A Google Maps link waiting to become a suggested restaurant. A link that becomes one is removed;
// one that cannot stays, so the user can see why.
export const suggestionQueue = p.snakeCase.table("suggestion_queue", {
  id: p.int({ mode: "number" }).primaryKey({ autoIncrement: true }),
  userId: p.int({ mode: "number" }).notNull().references(() => users.id, {onDelete: "cascade"}),
  link: p.text().notNull(),
  status: p.text({ enum: ["queued", "duplicate", "not-a-place", "failed"] }).notNull().default("queued"),
  name: p.text(),
  duplicateId: p.int({ mode: "number" }).references(() => restaurants.id, {onDelete: "set null"}),
  attempts: p.int().notNull().default(0),
  runAfter: p.int({ mode: "timestamp" }).notNull().$default(now),
  updatedAt: p.int({ mode: "timestamp" }).notNull().$onUpdate(now),
  createdAt: p.int({ mode: "timestamp" }).notNull().$default(now)
}, (t) => [
  p.index("suggestion_queue_status_run_after_id_idx").on(t.status, t.runAfter, t.id),
  p.index("suggestion_queue_user_id_created_at_id_idx").on(t.userId, t.createdAt, t.id),
  p.index("suggestion_queue_duplicate_id_idx").on(t.duplicateId),
])

export type QueuedSuggestion = typeof suggestionQueue.$inferSelect
export type QueuedSuggestionStatus = QueuedSuggestion["status"]

// The cities whose search key starts with the same two letters, in one row, the most populous first. One row
// for each city would cost more writes than the free plan allows in a day. The cities are a JSON array of
// CityGroupRow, written as text so that the 13 MB of the CityList are not turned into objects and back.
export const cityGroups = p.snakeCase.table("city_groups", {
  prefix: p.text().primaryKey(),
  cities: p.text().notNull(),
})

// A city as GeoNames lists it: [id, name, region, country code, latitude, longitude, population, search keys].
export type CityGroupRow = [number, string, string | null, string, number, number, number, string[]]

// An Admin's request to download the CityList from GeoNames. The newest finished one is the list in use.
export const cityListUpdates = p.snakeCase.table("city_list_updates", {
  id: p.int({ mode: "number" }).primaryKey({ autoIncrement: true }),
  requestedBy: p.int({ mode: "number" }).references(() => users.id, {onDelete: "set null"}),
  status: p.text({ enum: ["queued", "finished", "failed"] }).notNull().default("queued"),
  cityCount: p.int(),
  // Why the download failed.
  error: p.text(),
  updatedAt: p.int({ mode: "timestamp" }).notNull().$onUpdate(now),
  createdAt: p.int({ mode: "timestamp" }).notNull().$default(now)
}, (t) => [
  p.index("city_list_updates_status_id_idx").on(t.status, t.id),
  p.index("city_list_updates_requested_by_idx").on(t.requestedBy),
])

export type CityListUpdateStatus = (typeof cityListUpdates.$inferSelect)["status"]

// An Admin's request to find the kebab restaurants in a City. The City is copied, since the CityList may change.
export const citySearches = p.snakeCase.table("city_searches", {
  id: p.int({ mode: "number" }).primaryKey({ autoIncrement: true }),
  startedBy: p.int({ mode: "number" }).references(() => users.id, {onDelete: "set null"}),
  cityId: p.int({ mode: "number" }).notNull(),
  name: p.text().notNull(),
  region: p.text(),
  countryCode: p.text().notNull(),
  latitude: p.real().notNull(),
  longitude: p.real().notNull(),
  population: p.int().notNull(),
  status: p.text({ enum: ["queued", "adding", "finished", "failed"] }).notNull().default("queued"),
  attempts: p.int().notNull().default(0),
  runAfter: p.int({ mode: "timestamp" }).notNull().$default(now),
  updatedAt: p.int({ mode: "timestamp" }).notNull().$onUpdate(now),
  createdAt: p.int({ mode: "timestamp" }).notNull().$default(now)
}, (t) => [
  p.index("city_searches_status_run_after_id_idx").on(t.status, t.runAfter, t.id),
  p.index("city_searches_city_id_status_idx").on(t.cityId, t.status),
  p.index("city_searches_started_by_idx").on(t.startedBy),
])

export type CitySearchStatus = (typeof citySearches.$inferSelect)["status"]

// What happened while a CitySearch ran, as the Admin reads it: the servers it asked and what they answered,
// and the places it could not look up.
export const citySearchEvents = p.snakeCase.table("city_search_events", {
  id: p.int({ mode: "number" }).primaryKey({ autoIncrement: true }),
  citySearchId: p.int({ mode: "number" }).notNull().references(() => citySearches.id, {onDelete: "cascade"}),
  isError: p.int({ mode: "boolean" }).notNull().default(false),
  message: p.text().notNull(),
  createdAt: p.int({ mode: "timestamp" }).notNull().$default(now)
}, (t) => [
  p.index("city_search_events_city_search_id_id_idx").on(t.citySearchId, t.id),
])

// A place OpenStreetMap found for a CitySearch, waiting for its address before it becomes a Restaurant.
// The address is what OpenStreetMap knows of it.
export const citySearchCandidates = p.snakeCase.table("city_search_candidates", {
  id: p.int({ mode: "number" }).primaryKey({ autoIncrement: true }),
  citySearchId: p.int({ mode: "number" }).notNull().references(() => citySearches.id, {onDelete: "cascade"}),
  osmId: p.text().notNull(),
  name: p.text().notNull(),
  latitude: p.real().notNull(),
  longitude: p.real().notNull(),
  addressLine1: p.text(),
  postalCode: p.text(),
  city: p.text(),
  country: p.text(),
  attempts: p.int().notNull().default(0),
  runAfter: p.int({ mode: "timestamp" }).notNull().$default(now),
}, (t) => [
  p.index("city_search_candidates_run_after_id_idx").on(t.runAfter, t.id),
  p.uniqueIndex("city_search_candidates_city_search_id_osm_id_unique").on(t.citySearchId, t.osmId),
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
  id: p.int({ mode: "number" }).primaryKey({ autoIncrement: true }),
  sessionId: p.text().notNull().references(() => sessions.id, {onDelete: "cascade"}),
  requestedAt: p.int({ mode: "timestamp_ms" }).notNull(),
  method: p.text().notNull(),
  route: p.text().notNull(),
  path: p.text().notNull(),
  action: p.text(),
  status: p.int({ mode: "number" }).notNull(),
  prefetched: p.int({ mode: "boolean" }).notNull().default(false),
}, (t) => [
  p.index("history_session_id_requested_at_id_idx").on(t.sessionId, t.requestedAt, t.id),
  p.index("history_requested_at_idx").on(t.requestedAt),
])

export type NewHistoryEntry = typeof history.$inferInsert

export const notifications = p.snakeCase.table("notifications", {
  id: p.int({ mode: "number" }).primaryKey({ autoIncrement: true }),
  recipientId: p.int({ mode: "number" }).notNull().references(() => users.id, {onDelete: "cascade"}),
  kind: p.text({ enum: ["follow", "like", "suggestion-approved", "suggestion-rejected", "city-search-finished"] }).notNull(),
  actorId: p.int({ mode: "number" }).references(() => users.id, {onDelete: "cascade"}),
  reviewId: p.int({ mode: "number" }).references(() => reviews.id, {onDelete: "cascade"}),
  restaurantId: p.int({ mode: "number" }).references(() => restaurants.id, {onDelete: "cascade"}),
  citySearchId: p.int({ mode: "number" }).references(() => citySearches.id, {onDelete: "cascade"}),
  readAt: p.int({ mode: "timestamp" }),
  updatedAt: p.int({ mode: "timestamp" }).notNull().$onUpdate(now),
  createdAt: p.int({ mode: "timestamp" }).notNull().$default(now)
}, (t) => [
  p.index("notifications_recipient_id_created_at_id_idx").on(t.recipientId, t.createdAt, t.id),
  p.index("notifications_actor_id_idx").on(t.actorId),
  // Only likes have a review, only decisions have a restaurant and only finished searches have a search. The
  // other kinds leave the column null, and nulls never collide, so these indexes need no condition on the kind.
  p.uniqueIndex("notifications_review_id_actor_id_unique").on(t.reviewId, t.actorId),
  p.uniqueIndex("notifications_restaurant_id_unique").on(t.restaurantId),
  p.uniqueIndex("notifications_city_search_id_unique").on(t.citySearchId),
  p.uniqueIndex("notifications_follow_unique").on(t.recipientId, t.actorId).where(sql`${t.kind} = 'follow'`),
  p.check("notifications_not_own_action", sql`${t.actorId} IS NULL OR ${t.actorId} != ${t.recipientId}`),
  p.check("notifications_kind_columns", sql`CASE ${t.kind}
    WHEN 'follow' THEN ${t.actorId} IS NOT NULL AND ${t.reviewId} IS NULL AND ${t.restaurantId} IS NULL AND ${t.citySearchId} IS NULL
    WHEN 'like' THEN ${t.actorId} IS NOT NULL AND ${t.reviewId} IS NOT NULL AND ${t.restaurantId} IS NULL AND ${t.citySearchId} IS NULL
    WHEN 'city-search-finished' THEN ${t.actorId} IS NULL AND ${t.reviewId} IS NULL AND ${t.restaurantId} IS NULL AND ${t.citySearchId} IS NOT NULL
    ELSE ${t.actorId} IS NULL AND ${t.reviewId} IS NULL AND ${t.restaurantId} IS NOT NULL AND ${t.citySearchId} IS NULL
  END`),
])

export type NotificationKind = (typeof notifications.$inferSelect)["kind"]
export type SuggestionDecision = Extract<NotificationKind, `suggestion-${string}`>
