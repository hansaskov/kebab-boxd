CREATE TABLE `city_search_events` (
	`id` integer PRIMARY KEY AUTOINCREMENT,
	`city_search_id` integer NOT NULL,
	`is_error` integer DEFAULT false NOT NULL,
	`message` text NOT NULL,
	`created_at` integer NOT NULL,
	CONSTRAINT `fk_city_search_events_city_search_id_city_searches_id_fk` FOREIGN KEY (`city_search_id`) REFERENCES `city_searches`(`id`) ON DELETE CASCADE
);
--> statement-breakpoint
ALTER TABLE `city_list_updates` ADD `error` text;--> statement-breakpoint
CREATE INDEX `city_search_events_city_search_id_id_idx` ON `city_search_events` (`city_search_id`,`id`);