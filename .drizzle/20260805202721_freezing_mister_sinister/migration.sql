ALTER TABLE `users` RENAME COLUMN `is_admin` TO `role`;--> statement-breakpoint
PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_users` (
	`id` integer PRIMARY KEY AUTOINCREMENT,
	`fullname` text NOT NULL,
	`username` text NOT NULL,
	`email` text NOT NULL,
	`google_id` text NOT NULL,
	`profile_picture_id` integer,
	`role` text DEFAULT 'user' NOT NULL,
	`bio` text,
	`pronoun` text,
	`latitude` real,
	`longitude` real,
	`updated_at` integer NOT NULL,
	`created_at` integer NOT NULL,
	CONSTRAINT `fk_users_profile_picture_id_pictures_id_fk` FOREIGN KEY (`profile_picture_id`) REFERENCES `pictures`(`id`) ON DELETE SET NULL
);
--> statement-breakpoint
INSERT INTO `__new_users`(`id`, `fullname`, `username`, `email`, `google_id`, `profile_picture_id`, `role`, `bio`, `pronoun`, `latitude`, `longitude`, `updated_at`, `created_at`) SELECT `id`, `fullname`, `username`, `email`, `google_id`, `profile_picture_id`, `role`, `bio`, `pronoun`, `latitude`, `longitude`, `updated_at`, `created_at` FROM `users`;--> statement-breakpoint
DROP TABLE `users`;--> statement-breakpoint
ALTER TABLE `__new_users` RENAME TO `users`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
CREATE INDEX `users_profile_picture_id_idx` ON `users` (`profile_picture_id`);--> statement-breakpoint
CREATE INDEX `users_name_idx` ON `users` (`username`);--> statement-breakpoint
CREATE INDEX `users_email_idx` ON `users` (`email`);--> statement-breakpoint
CREATE INDEX `users_google_id_idx` ON `users` (`google_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `users_username_unique` ON `users` (`username`);--> statement-breakpoint
CREATE UNIQUE INDEX `users_email_unique` ON `users` (`email`);--> statement-breakpoint
CREATE UNIQUE INDEX `users_google_id_unique` ON `users` (`google_id`);