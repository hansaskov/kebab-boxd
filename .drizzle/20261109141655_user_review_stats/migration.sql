ALTER TABLE `users` ADD `public_review_count` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `users` ADD `latest_review_at` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
CREATE INDEX `users_public_review_count_id_idx` ON `users` (`public_review_count`,`id`);--> statement-breakpoint
CREATE INDEX `users_latest_review_at_id_idx` ON `users` (`latest_review_at`,`id`);--> statement-breakpoint
-- The stats of the users who wrote reviews before the columns existed, as refreshAuthorStats computes them: the
-- reviews in the ReviewWindow of approved restaurants. A private Profile has no time of its latest review.
UPDATE `users` SET
	`public_review_count` = `stats`.`count`,
	`latest_review_at` = CASE WHEN `users`.`is_private` THEN 0 ELSE `stats`.`latest` END
FROM (
	SELECT `reviews`.`author_id`, count(*) AS `count`, max(`reviews`.`created_at`) AS `latest`
	FROM `reviews`
	WHERE (
		SELECT count(*) FROM `reviews` AS `newer`
		WHERE `newer`.`author_id` = `reviews`.`author_id`
			AND `newer`.`restaurant_id` = `reviews`.`restaurant_id`
			AND (`newer`.`created_at`, `newer`.`id`) > (`reviews`.`created_at`, `reviews`.`id`)
	) < 3
		AND EXISTS (SELECT 1 FROM `restaurants` WHERE `restaurants`.`id` = `reviews`.`restaurant_id` AND `restaurants`.`status` = 'approved')
	GROUP BY `reviews`.`author_id`
) AS `stats`
WHERE `stats`.`author_id` = `users`.`id`;
