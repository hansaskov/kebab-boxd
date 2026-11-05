CREATE TABLE `city_groups` (
	`prefix` text PRIMARY KEY,
	`cities` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `city_list_updates` (
	`id` integer PRIMARY KEY AUTOINCREMENT,
	`requested_by` integer,
	`status` text DEFAULT 'queued' NOT NULL,
	`city_count` integer,
	`updated_at` integer NOT NULL,
	`created_at` integer NOT NULL,
	CONSTRAINT `fk_city_list_updates_requested_by_users_id_fk` FOREIGN KEY (`requested_by`) REFERENCES `users`(`id`) ON DELETE SET NULL
);
--> statement-breakpoint
CREATE TABLE `city_search_candidates` (
	`id` integer PRIMARY KEY AUTOINCREMENT,
	`city_search_id` integer NOT NULL,
	`osm_id` text NOT NULL,
	`name` text NOT NULL,
	`latitude` real NOT NULL,
	`longitude` real NOT NULL,
	`address_line1` text,
	`postal_code` text,
	`city` text,
	`country` text,
	`attempts` integer DEFAULT 0 NOT NULL,
	`run_after` integer NOT NULL,
	CONSTRAINT `fk_city_search_candidates_city_search_id_city_searches_id_fk` FOREIGN KEY (`city_search_id`) REFERENCES `city_searches`(`id`) ON DELETE CASCADE
);
--> statement-breakpoint
CREATE TABLE `city_searches` (
	`id` integer PRIMARY KEY AUTOINCREMENT,
	`started_by` integer,
	`city_id` integer NOT NULL,
	`name` text NOT NULL,
	`region` text,
	`country_code` text NOT NULL,
	`latitude` real NOT NULL,
	`longitude` real NOT NULL,
	`population` integer NOT NULL,
	`status` text DEFAULT 'queued' NOT NULL,
	`attempts` integer DEFAULT 0 NOT NULL,
	`run_after` integer NOT NULL,
	`updated_at` integer NOT NULL,
	`created_at` integer NOT NULL,
	CONSTRAINT `fk_city_searches_started_by_users_id_fk` FOREIGN KEY (`started_by`) REFERENCES `users`(`id`) ON DELETE SET NULL
);
--> statement-breakpoint
ALTER TABLE `notifications` ADD `city_search_id` integer REFERENCES city_searches(id) ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE `restaurants` ADD `osm_id` text;--> statement-breakpoint
ALTER TABLE `restaurants` ADD `city_search_id` integer REFERENCES city_searches(id) ON DELETE SET NULL;--> statement-breakpoint
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
	CONSTRAINT "notifications_kind_columns" CHECK(CASE "kind"
    WHEN 'follow' THEN "actor_id" IS NOT NULL AND "review_id" IS NULL AND "restaurant_id" IS NULL AND "city_search_id" IS NULL
    WHEN 'like' THEN "actor_id" IS NOT NULL AND "review_id" IS NOT NULL AND "restaurant_id" IS NULL AND "city_search_id" IS NULL
    WHEN 'city-search-finished' THEN "actor_id" IS NULL AND "review_id" IS NULL AND "restaurant_id" IS NULL AND "city_search_id" IS NOT NULL
    ELSE "actor_id" IS NULL AND "review_id" IS NULL AND "restaurant_id" IS NOT NULL AND "city_search_id" IS NULL
  END)
);
--> statement-breakpoint
INSERT INTO `__new_notifications`(`id`, `recipient_id`, `kind`, `actor_id`, `review_id`, `restaurant_id`, `read_at`, `updated_at`, `created_at`) SELECT `id`, `recipient_id`, `kind`, `actor_id`, `review_id`, `restaurant_id`, `read_at`, `updated_at`, `created_at` FROM `notifications`;--> statement-breakpoint
DROP TABLE `notifications`;--> statement-breakpoint
ALTER TABLE `__new_notifications` RENAME TO `notifications`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
CREATE INDEX `notifications_recipient_id_created_at_id_idx` ON `notifications` (`recipient_id`,`created_at`,`id`);--> statement-breakpoint
CREATE INDEX `notifications_actor_id_idx` ON `notifications` (`actor_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `notifications_review_id_actor_id_unique` ON `notifications` (`review_id`,`actor_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `notifications_restaurant_id_unique` ON `notifications` (`restaurant_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `notifications_city_search_id_unique` ON `notifications` (`city_search_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `notifications_follow_unique` ON `notifications` (`recipient_id`,`actor_id`) WHERE "notifications"."kind" = 'follow';--> statement-breakpoint
CREATE INDEX `city_list_updates_status_id_idx` ON `city_list_updates` (`status`,`id`);--> statement-breakpoint
CREATE INDEX `city_list_updates_requested_by_idx` ON `city_list_updates` (`requested_by`);--> statement-breakpoint
CREATE INDEX `city_search_candidates_run_after_id_idx` ON `city_search_candidates` (`run_after`,`id`);--> statement-breakpoint
CREATE UNIQUE INDEX `city_search_candidates_city_search_id_osm_id_unique` ON `city_search_candidates` (`city_search_id`,`osm_id`);--> statement-breakpoint
CREATE INDEX `city_searches_status_run_after_id_idx` ON `city_searches` (`status`,`run_after`,`id`);--> statement-breakpoint
CREATE INDEX `city_searches_city_id_status_idx` ON `city_searches` (`city_id`,`status`);--> statement-breakpoint
CREATE INDEX `city_searches_started_by_idx` ON `city_searches` (`started_by`);--> statement-breakpoint
CREATE INDEX `restaurants_osm_id_idx` ON `restaurants` (`osm_id`);--> statement-breakpoint
CREATE INDEX `restaurants_city_search_id_status_id_idx` ON `restaurants` (`city_search_id`,`status`,`id`);