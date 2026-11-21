CREATE TABLE `restaurant_counts` (
	`status` text PRIMARY KEY,
	`count` integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE `user_counts` (
	`filter` text PRIMARY KEY,
	`count` integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
ALTER TABLE `city_searches` ADD `restaurant_count` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `city_searches` ADD `approved_count` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `city_searches` ADD `rejected_count` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `city_searches` ADD `candidate_count` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `city_searches` ADD `retrying_candidate_count` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
-- The counts the admin pages show are kept by triggers, so every write keeps them right and no page counts rows.
INSERT INTO `restaurant_counts` (`status`, `count`)
SELECT `status`, (SELECT count(*) FROM `restaurants` WHERE `restaurants`.`status` = `statuses`.`status`)
FROM (SELECT 'approved' AS `status` UNION ALL SELECT 'pending' UNION ALL SELECT 'rejected') AS `statuses`;
--> statement-breakpoint
INSERT INTO `user_counts` (`filter`, `count`) VALUES
	('all', (SELECT count(*) FROM `users`)),
	('admin', (SELECT count(*) FROM `users` WHERE `role` = 'admin')),
	('banned', (SELECT count(*) FROM `users` WHERE `banned_at` IS NOT NULL));
--> statement-breakpoint
UPDATE `city_searches` SET
	`restaurant_count` = (SELECT count(*) FROM `restaurants` WHERE `restaurants`.`city_search_id` = `city_searches`.`id`),
	`approved_count` = (SELECT count(*) FROM `restaurants` WHERE `restaurants`.`city_search_id` = `city_searches`.`id` AND `restaurants`.`status` = 'approved'),
	`rejected_count` = (SELECT count(*) FROM `restaurants` WHERE `restaurants`.`city_search_id` = `city_searches`.`id` AND `restaurants`.`status` = 'rejected'),
	`candidate_count` = (SELECT count(*) FROM `city_search_candidates` WHERE `city_search_candidates`.`city_search_id` = `city_searches`.`id`),
	`retrying_candidate_count` = (
		SELECT count(*) FROM `city_search_candidates`
		WHERE `city_search_candidates`.`city_search_id` = `city_searches`.`id` AND `city_search_candidates`.`attempts` > 0
	);
--> statement-breakpoint
CREATE TRIGGER `restaurants_counted_on_insert` AFTER INSERT ON `restaurants` BEGIN
	UPDATE `restaurant_counts` SET `count` = `count` + 1 WHERE `status` = NEW.`status`;
	UPDATE `city_searches` SET
		`restaurant_count` = `restaurant_count` + 1,
		`approved_count` = `approved_count` + (NEW.`status` = 'approved'),
		`rejected_count` = `rejected_count` + (NEW.`status` = 'rejected')
	WHERE `id` = NEW.`city_search_id`;
END;
--> statement-breakpoint
CREATE TRIGGER `restaurants_counted_on_update` AFTER UPDATE OF `status`, `city_search_id` ON `restaurants`
WHEN OLD.`status` IS NOT NEW.`status` OR OLD.`city_search_id` IS NOT NEW.`city_search_id` BEGIN
	UPDATE `restaurant_counts` SET `count` = `count` - 1 WHERE `status` = OLD.`status`;
	UPDATE `restaurant_counts` SET `count` = `count` + 1 WHERE `status` = NEW.`status`;
	UPDATE `city_searches` SET
		`restaurant_count` = `restaurant_count` - 1,
		`approved_count` = `approved_count` - (OLD.`status` = 'approved'),
		`rejected_count` = `rejected_count` - (OLD.`status` = 'rejected')
	WHERE `id` = OLD.`city_search_id`;
	UPDATE `city_searches` SET
		`restaurant_count` = `restaurant_count` + 1,
		`approved_count` = `approved_count` + (NEW.`status` = 'approved'),
		`rejected_count` = `rejected_count` + (NEW.`status` = 'rejected')
	WHERE `id` = NEW.`city_search_id`;
END;
--> statement-breakpoint
CREATE TRIGGER `restaurants_counted_on_delete` AFTER DELETE ON `restaurants` BEGIN
	UPDATE `restaurant_counts` SET `count` = `count` - 1 WHERE `status` = OLD.`status`;
	UPDATE `city_searches` SET
		`restaurant_count` = `restaurant_count` - 1,
		`approved_count` = `approved_count` - (OLD.`status` = 'approved'),
		`rejected_count` = `rejected_count` - (OLD.`status` = 'rejected')
	WHERE `id` = OLD.`city_search_id`;
END;
--> statement-breakpoint
CREATE TRIGGER `city_search_candidates_counted_on_insert` AFTER INSERT ON `city_search_candidates` BEGIN
	UPDATE `city_searches` SET
		`candidate_count` = `candidate_count` + 1,
		`retrying_candidate_count` = `retrying_candidate_count` + (NEW.`attempts` > 0)
	WHERE `id` = NEW.`city_search_id`;
END;
--> statement-breakpoint
CREATE TRIGGER `city_search_candidates_counted_on_update` AFTER UPDATE OF `attempts`, `city_search_id` ON `city_search_candidates`
WHEN (OLD.`attempts` > 0) IS NOT (NEW.`attempts` > 0) OR OLD.`city_search_id` IS NOT NEW.`city_search_id` BEGIN
	UPDATE `city_searches` SET
		`candidate_count` = `candidate_count` - 1,
		`retrying_candidate_count` = `retrying_candidate_count` - (OLD.`attempts` > 0)
	WHERE `id` = OLD.`city_search_id`;
	UPDATE `city_searches` SET
		`candidate_count` = `candidate_count` + 1,
		`retrying_candidate_count` = `retrying_candidate_count` + (NEW.`attempts` > 0)
	WHERE `id` = NEW.`city_search_id`;
END;
--> statement-breakpoint
CREATE TRIGGER `city_search_candidates_counted_on_delete` AFTER DELETE ON `city_search_candidates` BEGIN
	UPDATE `city_searches` SET
		`candidate_count` = `candidate_count` - 1,
		`retrying_candidate_count` = `retrying_candidate_count` - (OLD.`attempts` > 0)
	WHERE `id` = OLD.`city_search_id`;
END;
--> statement-breakpoint
CREATE TRIGGER `users_counted_on_insert` AFTER INSERT ON `users` BEGIN
	UPDATE `user_counts` SET `count` = `count` + 1
	WHERE `filter` = 'all' OR (`filter` = 'admin' AND NEW.`role` = 'admin') OR (`filter` = 'banned' AND NEW.`banned_at` IS NOT NULL);
END;
--> statement-breakpoint
CREATE TRIGGER `users_counted_on_update` AFTER UPDATE OF `role`, `banned_at` ON `users`
WHEN OLD.`role` IS NOT NEW.`role` OR (OLD.`banned_at` IS NULL) IS NOT (NEW.`banned_at` IS NULL) BEGIN
	UPDATE `user_counts` SET `count` = `count` + (NEW.`role` = 'admin') - (OLD.`role` = 'admin') WHERE `filter` = 'admin';
	UPDATE `user_counts` SET `count` = `count` + (NEW.`banned_at` IS NOT NULL) - (OLD.`banned_at` IS NOT NULL) WHERE `filter` = 'banned';
END;
--> statement-breakpoint
CREATE TRIGGER `users_counted_on_delete` AFTER DELETE ON `users` BEGIN
	UPDATE `user_counts` SET `count` = `count` - 1
	WHERE `filter` = 'all' OR (`filter` = 'admin' AND OLD.`role` = 'admin') OR (`filter` = 'banned' AND OLD.`banned_at` IS NOT NULL);
END;
