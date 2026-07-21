PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_reviews` (
	`id` integer PRIMARY KEY AUTOINCREMENT,
	`author_id` integer NOT NULL,
	`restaurant_id` integer NOT NULL,
	`rating` integer NOT NULL,
	`description` text,
	`like_count` integer DEFAULT 0 NOT NULL,
	`updated_at` integer NOT NULL,
	`created_at` integer NOT NULL,
	CONSTRAINT `fk_reviews_author_id_users_id_fk` FOREIGN KEY (`author_id`) REFERENCES `users`(`id`) ON DELETE CASCADE,
	CONSTRAINT `fk_reviews_restaurant_id_restaurants_id_fk` FOREIGN KEY (`restaurant_id`) REFERENCES `restaurants`(`id`),
	CONSTRAINT "reviews_rating_range" CHECK("rating" BETWEEN 2 AND 10)
);
--> statement-breakpoint
INSERT INTO `__new_reviews`(`id`, `author_id`, `restaurant_id`, `rating`, `description`, `like_count`, `updated_at`, `created_at`) SELECT `id`, `author_id`, `restaurant_id`, `rating`, `description`, `like_count`, `updated_at`, `created_at` FROM `reviews`;--> statement-breakpoint
DROP TABLE `reviews`;--> statement-breakpoint
ALTER TABLE `__new_reviews` RENAME TO `reviews`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
CREATE INDEX `reviews_author_id_idx` ON `reviews` (`author_id`);--> statement-breakpoint
CREATE INDEX `reviews_restaurant_id_idx` ON `reviews` (`restaurant_id`);