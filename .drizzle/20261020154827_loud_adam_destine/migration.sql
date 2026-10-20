DROP INDEX IF EXISTS `users_username_unique`;--> statement-breakpoint
CREATE UNIQUE INDEX `users_username_lower_unique` ON `users` (lower("username"));