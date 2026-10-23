ALTER TABLE `history` ADD `id` integer;--> statement-breakpoint
PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_history` (
	`id` integer PRIMARY KEY AUTOINCREMENT,
	`session_id` text NOT NULL,
	`requested_at` integer NOT NULL,
	`method` text NOT NULL,
	`route` text NOT NULL,
	`path` text NOT NULL,
	`action` text,
	`status` integer NOT NULL,
	`prefetched` integer DEFAULT false NOT NULL,
	CONSTRAINT `fk_history_session_id_sessions_id_fk` FOREIGN KEY (`session_id`) REFERENCES `sessions`(`id`) ON DELETE CASCADE
);
--> statement-breakpoint
INSERT INTO `__new_history`(`session_id`, `requested_at`, `method`, `route`, `path`, `action`, `status`, `prefetched`) SELECT `session_id`, `requested_at`, `method`, `route`, `path`, `action`, `status`, `prefetched` FROM `history`;--> statement-breakpoint
DROP TABLE `history`;--> statement-breakpoint
ALTER TABLE `__new_history` RENAME TO `history`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
CREATE INDEX `history_session_id_requested_at_id_idx` ON `history` (`session_id`,`requested_at`,`id`);--> statement-breakpoint
CREATE INDEX `history_requested_at_idx` ON `history` (`requested_at`);