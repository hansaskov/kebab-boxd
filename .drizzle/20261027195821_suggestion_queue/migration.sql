CREATE TABLE `suggestion_queue` (
	`id` integer PRIMARY KEY AUTOINCREMENT,
	`user_id` integer NOT NULL,
	`link` text NOT NULL,
	`status` text DEFAULT 'queued' NOT NULL,
	`name` text,
	`duplicate_id` integer,
	`attempts` integer DEFAULT 0 NOT NULL,
	`run_after` integer NOT NULL,
	`updated_at` integer NOT NULL,
	`created_at` integer NOT NULL,
	CONSTRAINT `fk_suggestion_queue_user_id_users_id_fk` FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE CASCADE,
	CONSTRAINT `fk_suggestion_queue_duplicate_id_restaurants_id_fk` FOREIGN KEY (`duplicate_id`) REFERENCES `restaurants`(`id`) ON DELETE SET NULL
);
--> statement-breakpoint
ALTER TABLE `restaurants` ADD `google_maps_id` text;--> statement-breakpoint
DROP INDEX IF EXISTS `restaurants_google_place_id_unique`;--> statement-breakpoint
CREATE INDEX `restaurants_google_maps_id_idx` ON `restaurants` (`google_maps_id`);--> statement-breakpoint
CREATE INDEX `suggestion_queue_status_run_after_id_idx` ON `suggestion_queue` (`status`,`run_after`,`id`);--> statement-breakpoint
CREATE INDEX `suggestion_queue_user_id_created_at_id_idx` ON `suggestion_queue` (`user_id`,`created_at`,`id`);--> statement-breakpoint
CREATE INDEX `suggestion_queue_duplicate_id_idx` ON `suggestion_queue` (`duplicate_id`);--> statement-breakpoint
ALTER TABLE `restaurants` DROP COLUMN `google_place_id`;