PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_sessions` (
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
INSERT INTO `__new_sessions`(`id`, `user_id`, `secret_hash`, `last_verified_at`, `theme`, `action_data`, `updated_at`, `created_at`) SELECT `id`, `user_id`, `secret_hash`, `last_verified_at`, `theme`, `action_data`, `updated_at`, `created_at` FROM `sessions`;--> statement-breakpoint
DROP TABLE `sessions`;--> statement-breakpoint
ALTER TABLE `__new_sessions` RENAME TO `sessions`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
CREATE INDEX `sessions_user_id_idx` ON `sessions` (`user_id`);