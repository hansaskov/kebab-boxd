DROP INDEX IF EXISTS `reviews_restaurant_id_idx`;--> statement-breakpoint
CREATE INDEX `locations_latitude_longitude_idx` ON `locations` (`latitude`,`longitude`);--> statement-breakpoint
CREATE INDEX `restaurants_status_id_idx` ON `restaurants` (`status`,`id`);--> statement-breakpoint
CREATE INDEX `restaurants_status_rating_avg_id_idx` ON `restaurants` (`status`,`rating_avg`,`id`);--> statement-breakpoint
CREATE INDEX `restaurants_status_review_count_id_idx` ON `restaurants` (`status`,`review_count`,`id`);--> statement-breakpoint
CREATE INDEX `reviews_restaurant_id_created_at_id_idx` ON `reviews` (`restaurant_id`,`created_at`,`id`);--> statement-breakpoint
CREATE INDEX `reviews_created_at_id_idx` ON `reviews` (`created_at`,`id`);