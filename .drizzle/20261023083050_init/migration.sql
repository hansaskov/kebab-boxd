CREATE TABLE `accounts` (
	`id` integer PRIMARY KEY AUTOINCREMENT,
	`user_id` integer NOT NULL,
	`account_id` text NOT NULL,
	`provider_id` text NOT NULL,
	`updated_at` integer NOT NULL,
	`created_at` integer NOT NULL,
	CONSTRAINT `fk_accounts_user_id_users_id_fk` FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE CASCADE
);
--> statement-breakpoint
CREATE TABLE `bucket_list` (
	`user_id` integer NOT NULL,
	`restaurant_id` integer NOT NULL,
	`updated_at` integer NOT NULL,
	`created_at` integer NOT NULL,
	CONSTRAINT `bucket_list_pk` PRIMARY KEY(`user_id`, `restaurant_id`),
	CONSTRAINT `fk_bucket_list_user_id_users_id_fk` FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE CASCADE,
	CONSTRAINT `fk_bucket_list_restaurant_id_restaurants_id_fk` FOREIGN KEY (`restaurant_id`) REFERENCES `restaurants`(`id`) ON DELETE CASCADE
);
--> statement-breakpoint
CREATE TABLE `favorites` (
	`user_id` integer NOT NULL,
	`restaurant_id` integer NOT NULL,
	`updated_at` integer NOT NULL,
	`created_at` integer NOT NULL,
	CONSTRAINT `favorites_pk` PRIMARY KEY(`user_id`, `restaurant_id`),
	CONSTRAINT `fk_favorites_user_id_users_id_fk` FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE CASCADE,
	CONSTRAINT `fk_favorites_restaurant_id_restaurants_id_fk` FOREIGN KEY (`restaurant_id`) REFERENCES `restaurants`(`id`) ON DELETE CASCADE
);
--> statement-breakpoint
CREATE TABLE `followers` (
	`follower_id` integer NOT NULL,
	`following_id` integer NOT NULL,
	`updated_at` integer NOT NULL,
	`created_at` integer NOT NULL,
	CONSTRAINT `followers_pk` PRIMARY KEY(`follower_id`, `following_id`),
	CONSTRAINT `fk_followers_follower_id_users_id_fk` FOREIGN KEY (`follower_id`) REFERENCES `users`(`id`) ON DELETE CASCADE,
	CONSTRAINT `fk_followers_following_id_users_id_fk` FOREIGN KEY (`following_id`) REFERENCES `users`(`id`) ON DELETE CASCADE,
	CONSTRAINT "followers_no_self_follow" CHECK("follower_id" != "following_id")
);
--> statement-breakpoint
CREATE TABLE `history` (
	`session_id` text NOT NULL,
	`requested_at` integer NOT NULL,
	`method` text NOT NULL,
	`route` text NOT NULL,
	`path` text NOT NULL,
	`action` text,
	`status` integer NOT NULL,
	`prefetched` integer DEFAULT false NOT NULL,
	CONSTRAINT `history_pk` PRIMARY KEY(`session_id`, `requested_at`),
	CONSTRAINT `fk_history_session_id_sessions_id_fk` FOREIGN KEY (`session_id`) REFERENCES `sessions`(`id`) ON DELETE CASCADE
);
--> statement-breakpoint
CREATE TABLE `likes` (
	`user_id` integer NOT NULL,
	`review_id` integer NOT NULL,
	`updated_at` integer NOT NULL,
	`created_at` integer NOT NULL,
	CONSTRAINT `likes_pk` PRIMARY KEY(`user_id`, `review_id`),
	CONSTRAINT `fk_likes_user_id_users_id_fk` FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE CASCADE,
	CONSTRAINT `fk_likes_review_id_reviews_id_fk` FOREIGN KEY (`review_id`) REFERENCES `reviews`(`id`) ON DELETE CASCADE
);
--> statement-breakpoint
CREATE TABLE `locations` (
	`id` integer PRIMARY KEY AUTOINCREMENT,
	`address_line1` text,
	`address_line2` text,
	`city` text,
	`postal_code` text,
	`region` text,
	`country` text,
	`latitude` real NOT NULL,
	`longitude` real NOT NULL,
	`updated_at` integer NOT NULL,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `pictures` (
	`id` integer PRIMARY KEY AUTOINCREMENT,
	`url` text NOT NULL UNIQUE,
	`updated_at` integer NOT NULL,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `restaurants` (
	`id` integer PRIMARY KEY AUTOINCREMENT,
	`name` text NOT NULL,
	`location_id` integer NOT NULL,
	`suggested_by` integer,
	`status` text DEFAULT 'pending' NOT NULL,
	`google_place_id` text,
	`rating_avg` real DEFAULT 0 NOT NULL,
	`review_count` integer DEFAULT 0 NOT NULL,
	`updated_at` integer NOT NULL,
	`created_at` integer NOT NULL,
	CONSTRAINT `fk_restaurants_location_id_locations_id_fk` FOREIGN KEY (`location_id`) REFERENCES `locations`(`id`),
	CONSTRAINT `fk_restaurants_suggested_by_users_id_fk` FOREIGN KEY (`suggested_by`) REFERENCES `users`(`id`)
);
--> statement-breakpoint
CREATE TABLE `review_pictures` (
	`review_id` integer NOT NULL,
	`picture_id` integer NOT NULL,
	`updated_at` integer NOT NULL,
	`created_at` integer NOT NULL,
	CONSTRAINT `review_pictures_pk` PRIMARY KEY(`picture_id`, `review_id`),
	CONSTRAINT `fk_review_pictures_review_id_reviews_id_fk` FOREIGN KEY (`review_id`) REFERENCES `reviews`(`id`) ON DELETE CASCADE,
	CONSTRAINT `fk_review_pictures_picture_id_pictures_id_fk` FOREIGN KEY (`picture_id`) REFERENCES `pictures`(`id`) ON DELETE CASCADE
);
--> statement-breakpoint
CREATE TABLE `reviews` (
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
CREATE TABLE `sessions` (
	`id` text PRIMARY KEY,
	`user_id` integer NOT NULL,
	`secret_hash` blob NOT NULL,
	`last_verified_at` integer NOT NULL,
	`theme` text DEFAULT 'light' NOT NULL,
	`action_data` text,
	`updated_at` integer NOT NULL,
	`created_at` integer NOT NULL,
	CONSTRAINT `fk_sessions_user_id_users_id_fk` FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE CASCADE
);
--> statement-breakpoint
CREATE TABLE `users` (
	`id` integer PRIMARY KEY AUTOINCREMENT,
	`fullname` text NOT NULL,
	`username` text NOT NULL,
	`email` text NOT NULL,
	`email_verified` integer NOT NULL,
	`profile_picture_id` integer,
	`role` text DEFAULT 'user' NOT NULL,
	`bio` text,
	`pronoun` text,
	`latitude` real,
	`longitude` real,
	`banned_at` integer,
	`updated_at` integer NOT NULL,
	`created_at` integer NOT NULL,
	CONSTRAINT `fk_users_profile_picture_id_pictures_id_fk` FOREIGN KEY (`profile_picture_id`) REFERENCES `pictures`(`id`) ON DELETE SET NULL
);
--> statement-breakpoint
CREATE INDEX `accounts_user_id_idx` ON `accounts` (`user_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `accounts_provider_id_account_id_unique` ON `accounts` (`provider_id`,`account_id`);--> statement-breakpoint
CREATE INDEX `bucket_list_user_id_created_at_restaurant_id_idx` ON `bucket_list` (`user_id`,`created_at`,`restaurant_id`);--> statement-breakpoint
CREATE INDEX `bucket_list_restaurant_id_idx` ON `bucket_list` (`restaurant_id`);--> statement-breakpoint
CREATE INDEX `favorites_user_id_created_at_restaurant_id_idx` ON `favorites` (`user_id`,`created_at`,`restaurant_id`);--> statement-breakpoint
CREATE INDEX `favorites_restaurant_id_idx` ON `favorites` (`restaurant_id`);--> statement-breakpoint
CREATE INDEX `followers_following_id_idx` ON `followers` (`following_id`);--> statement-breakpoint
CREATE INDEX `history_requested_at_idx` ON `history` (`requested_at`);--> statement-breakpoint
CREATE INDEX `likes_review_id_idx` ON `likes` (`review_id`);--> statement-breakpoint
CREATE INDEX `restaurants_location_id_idx` ON `restaurants` (`location_id`);--> statement-breakpoint
CREATE INDEX `restaurants_suggested_by_idx` ON `restaurants` (`suggested_by`);--> statement-breakpoint
CREATE UNIQUE INDEX `restaurants_google_place_id_unique` ON `restaurants` (`google_place_id`);--> statement-breakpoint
CREATE INDEX `review_pictures_review_id_idx` ON `review_pictures` (`review_id`);--> statement-breakpoint
CREATE INDEX `reviews_author_id_created_at_id_idx` ON `reviews` (`author_id`,`created_at`,`id`);--> statement-breakpoint
CREATE INDEX `reviews_author_id_restaurant_id_created_at_id_idx` ON `reviews` (`author_id`,`restaurant_id`,"created_at" desc,"id" desc);--> statement-breakpoint
CREATE INDEX `reviews_restaurant_id_idx` ON `reviews` (`restaurant_id`);--> statement-breakpoint
CREATE INDEX `sessions_user_id_idx` ON `sessions` (`user_id`);--> statement-breakpoint
CREATE INDEX `sessions_last_verified_at_idx` ON `sessions` (`last_verified_at`);--> statement-breakpoint
CREATE INDEX `users_profile_picture_id_idx` ON `users` (`profile_picture_id`);--> statement-breakpoint
CREATE INDEX `users_name_idx` ON `users` (`username`);--> statement-breakpoint
CREATE INDEX `users_email_idx` ON `users` (`email`);--> statement-breakpoint
CREATE UNIQUE INDEX `users_username_lower_unique` ON `users` (lower("username"));--> statement-breakpoint
CREATE UNIQUE INDEX `users_email_unique` ON `users` (lower("email"));