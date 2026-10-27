CREATE TABLE `notifications` (
	`id` integer PRIMARY KEY AUTOINCREMENT,
	`recipient_id` integer NOT NULL,
	`kind` text NOT NULL,
	`actor_id` integer,
	`review_id` integer,
	`restaurant_id` integer,
	`read_at` integer,
	`updated_at` integer NOT NULL,
	`created_at` integer NOT NULL,
	CONSTRAINT `fk_notifications_recipient_id_users_id_fk` FOREIGN KEY (`recipient_id`) REFERENCES `users`(`id`) ON DELETE CASCADE,
	CONSTRAINT `fk_notifications_actor_id_users_id_fk` FOREIGN KEY (`actor_id`) REFERENCES `users`(`id`) ON DELETE CASCADE,
	CONSTRAINT `fk_notifications_review_id_reviews_id_fk` FOREIGN KEY (`review_id`) REFERENCES `reviews`(`id`) ON DELETE CASCADE,
	CONSTRAINT `fk_notifications_restaurant_id_restaurants_id_fk` FOREIGN KEY (`restaurant_id`) REFERENCES `restaurants`(`id`) ON DELETE CASCADE,
	CONSTRAINT "notifications_not_own_action" CHECK("actor_id" IS NULL OR "actor_id" != "recipient_id"),
	CONSTRAINT "notifications_kind_columns" CHECK(CASE "kind"
    WHEN 'follow' THEN "actor_id" IS NOT NULL AND "review_id" IS NULL AND "restaurant_id" IS NULL
    WHEN 'like' THEN "actor_id" IS NOT NULL AND "review_id" IS NOT NULL AND "restaurant_id" IS NULL
    ELSE "actor_id" IS NULL AND "review_id" IS NULL AND "restaurant_id" IS NOT NULL
  END)
);
--> statement-breakpoint
ALTER TABLE `users` ADD `follow_notifications` integer DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE `users` ADD `like_notifications` integer DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE `users` ADD `suggestion_notifications` integer DEFAULT true NOT NULL;--> statement-breakpoint
CREATE INDEX `notifications_recipient_id_created_at_id_idx` ON `notifications` (`recipient_id`,`created_at`,`id`);--> statement-breakpoint
CREATE INDEX `notifications_actor_id_idx` ON `notifications` (`actor_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `notifications_review_id_actor_id_unique` ON `notifications` (`review_id`,`actor_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `notifications_restaurant_id_unique` ON `notifications` (`restaurant_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `notifications_follow_unique` ON `notifications` (`recipient_id`,`actor_id`) WHERE "notifications"."kind" = 'follow';