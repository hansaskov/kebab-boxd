CREATE TABLE `follow_requests` (
	`follower_id` integer NOT NULL,
	`following_id` integer NOT NULL,
	`updated_at` integer NOT NULL,
	`created_at` integer NOT NULL,
	CONSTRAINT `follow_requests_pk` PRIMARY KEY(`follower_id`, `following_id`),
	CONSTRAINT `fk_follow_requests_follower_id_users_id_fk` FOREIGN KEY (`follower_id`) REFERENCES `users`(`id`) ON DELETE CASCADE,
	CONSTRAINT `fk_follow_requests_following_id_users_id_fk` FOREIGN KEY (`following_id`) REFERENCES `users`(`id`) ON DELETE CASCADE,
	CONSTRAINT "follow_requests_no_self_follow" CHECK("follower_id" != "following_id")
);
--> statement-breakpoint
ALTER TABLE `users` ADD `is_private` integer DEFAULT false NOT NULL;--> statement-breakpoint
PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_notifications` (
	`id` integer PRIMARY KEY AUTOINCREMENT,
	`recipient_id` integer NOT NULL,
	`kind` text NOT NULL,
	`actor_id` integer,
	`review_id` integer,
	`restaurant_id` integer,
	`city_search_id` integer,
	`read_at` integer,
	`updated_at` integer NOT NULL,
	`created_at` integer NOT NULL,
	CONSTRAINT `fk_notifications_recipient_id_users_id_fk` FOREIGN KEY (`recipient_id`) REFERENCES `users`(`id`) ON DELETE CASCADE,
	CONSTRAINT `fk_notifications_actor_id_users_id_fk` FOREIGN KEY (`actor_id`) REFERENCES `users`(`id`) ON DELETE CASCADE,
	CONSTRAINT `fk_notifications_review_id_reviews_id_fk` FOREIGN KEY (`review_id`) REFERENCES `reviews`(`id`) ON DELETE CASCADE,
	CONSTRAINT `fk_notifications_restaurant_id_restaurants_id_fk` FOREIGN KEY (`restaurant_id`) REFERENCES `restaurants`(`id`) ON DELETE CASCADE,
	CONSTRAINT `fk_notifications_city_search_id_city_searches_id_fk` FOREIGN KEY (`city_search_id`) REFERENCES `city_searches`(`id`) ON DELETE CASCADE,
	CONSTRAINT "notifications_not_own_action" CHECK("actor_id" IS NULL OR "actor_id" != "recipient_id"),
	CONSTRAINT "notifications_kind_columns" CHECK(CASE
    WHEN "kind" IN ('follow', 'follow-request', 'follow-accepted') THEN "actor_id" IS NOT NULL AND "review_id" IS NULL AND "restaurant_id" IS NULL AND "city_search_id" IS NULL
    WHEN "kind" = 'like' THEN "actor_id" IS NOT NULL AND "review_id" IS NOT NULL AND "restaurant_id" IS NULL AND "city_search_id" IS NULL
    WHEN "kind" = 'city-search-finished' THEN "actor_id" IS NULL AND "review_id" IS NULL AND "restaurant_id" IS NULL AND "city_search_id" IS NOT NULL
    ELSE "actor_id" IS NULL AND "review_id" IS NULL AND "restaurant_id" IS NOT NULL AND "city_search_id" IS NULL
  END)
);
--> statement-breakpoint
INSERT INTO `__new_notifications`(`id`, `recipient_id`, `kind`, `actor_id`, `review_id`, `restaurant_id`, `city_search_id`, `read_at`, `updated_at`, `created_at`) SELECT `id`, `recipient_id`, `kind`, `actor_id`, `review_id`, `restaurant_id`, `city_search_id`, `read_at`, `updated_at`, `created_at` FROM `notifications`;--> statement-breakpoint
DROP TABLE `notifications`;--> statement-breakpoint
ALTER TABLE `__new_notifications` RENAME TO `notifications`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
DROP INDEX IF EXISTS `notifications_follow_unique`;--> statement-breakpoint
CREATE INDEX `notifications_recipient_id_created_at_id_idx` ON `notifications` (`recipient_id`,`created_at`,`id`);--> statement-breakpoint
CREATE INDEX `notifications_actor_id_idx` ON `notifications` (`actor_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `notifications_review_id_actor_id_unique` ON `notifications` (`review_id`,`actor_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `notifications_restaurant_id_unique` ON `notifications` (`restaurant_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `notifications_city_search_id_unique` ON `notifications` (`city_search_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `notifications_follow_kinds_unique` ON `notifications` (`recipient_id`,`actor_id`,`kind`) WHERE "notifications"."kind" IN ('follow', 'follow-request', 'follow-accepted');--> statement-breakpoint
CREATE INDEX `follow_requests_following_id_created_at_follower_id_idx` ON `follow_requests` (`following_id`,`created_at`,`follower_id`);