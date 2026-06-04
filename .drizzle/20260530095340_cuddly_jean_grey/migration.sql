PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_users` (
	`id` integer PRIMARY KEY AUTOINCREMENT,
	`username` text NOT NULL,
	`email` text NOT NULL UNIQUE,
	`google_id` text NOT NULL UNIQUE,
	`profile_picture_id` integer,
	`is_admin` integer DEFAULT false NOT NULL,
	`bio` text,
	`pronoun` text,
	`latitude` real,
	`longitude` real,
	`updated_at` integer NOT NULL,
	`created_at` integer NOT NULL,
	CONSTRAINT `fk_users_profile_picture_id_pictures_id_fk` FOREIGN KEY (`profile_picture_id`) REFERENCES `pictures`(`id`) ON DELETE SET NULL
);
--> statement-breakpoint
INSERT INTO `__new_users`(`id`, `username`, `email`, `google_id`, `profile_picture_id`, `is_admin`, `bio`, `pronoun`, `latitude`, `longitude`, `updated_at`, `created_at`) SELECT `id`, `username`, `email`, `google_id`, `profile_picture_id`, `is_admin`, `bio`, `pronoun`, `latitude`, `longitude`, `updated_at`, `created_at` FROM `users`;--> statement-breakpoint
DROP TABLE `users`;--> statement-breakpoint
ALTER TABLE `__new_users` RENAME TO `users`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
CREATE INDEX `users_profile_picture_id_idx` ON `users` (`profile_picture_id`);