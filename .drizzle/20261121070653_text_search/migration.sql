CREATE INDEX `restaurants_name_nocase_idx` ON `restaurants` ("name" collate nocase);--> statement-breakpoint
CREATE INDEX `users_fullname_nocase_idx` ON `users` ("fullname" collate nocase);--> statement-breakpoint
CREATE INDEX `users_email_nocase_idx` ON `users` ("email" collate nocase);--> statement-breakpoint
-- A search of three characters or more finds them anywhere in a name, without regard to letter case or accents, through
-- these trigram indexes, which triggers keep in step with the restaurants and users. The rowid is the id of the row.
CREATE VIRTUAL TABLE `restaurant_search` USING fts5(`name`, `city`, tokenize = 'trigram remove_diacritics 1');
--> statement-breakpoint
INSERT INTO `restaurant_search` (`rowid`, `name`, `city`)
SELECT `restaurants`.`id`, `restaurants`.`name`, `locations`.`city`
FROM `restaurants` JOIN `locations` ON `locations`.`id` = `restaurants`.`location_id`;
--> statement-breakpoint
CREATE TRIGGER `restaurants_searchable_on_insert` AFTER INSERT ON `restaurants` BEGIN
	INSERT INTO `restaurant_search` (`rowid`, `name`, `city`)
	VALUES (NEW.`id`, NEW.`name`, (SELECT `city` FROM `locations` WHERE `id` = NEW.`location_id`));
END;
--> statement-breakpoint
CREATE TRIGGER `restaurants_searchable_on_update` AFTER UPDATE OF `name`, `location_id` ON `restaurants` BEGIN
	UPDATE `restaurant_search` SET `name` = NEW.`name`, `city` = (SELECT `city` FROM `locations` WHERE `id` = NEW.`location_id`)
	WHERE `rowid` = NEW.`id`;
END;
--> statement-breakpoint
CREATE TRIGGER `restaurants_searchable_on_delete` AFTER DELETE ON `restaurants` BEGIN
	DELETE FROM `restaurant_search` WHERE `rowid` = OLD.`id`;
END;
--> statement-breakpoint
CREATE TRIGGER `locations_searchable_on_update` AFTER UPDATE OF `city` ON `locations` BEGIN
	UPDATE `restaurant_search` SET `city` = NEW.`city` WHERE `rowid` IN (SELECT `id` FROM `restaurants` WHERE `location_id` = NEW.`id`);
END;
--> statement-breakpoint
CREATE VIRTUAL TABLE `user_search` USING fts5(`username`, `fullname`, `email`, tokenize = 'trigram remove_diacritics 1');
--> statement-breakpoint
INSERT INTO `user_search` (`rowid`, `username`, `fullname`, `email`) SELECT `id`, `username`, `fullname`, `email` FROM `users`;
--> statement-breakpoint
CREATE TRIGGER `users_searchable_on_insert` AFTER INSERT ON `users` BEGIN
	INSERT INTO `user_search` (`rowid`, `username`, `fullname`, `email`) VALUES (NEW.`id`, NEW.`username`, NEW.`fullname`, NEW.`email`);
END;
--> statement-breakpoint
CREATE TRIGGER `users_searchable_on_update` AFTER UPDATE OF `username`, `fullname`, `email` ON `users` BEGIN
	UPDATE `user_search` SET `username` = NEW.`username`, `fullname` = NEW.`fullname`, `email` = NEW.`email` WHERE `rowid` = NEW.`id`;
END;
--> statement-breakpoint
CREATE TRIGGER `users_searchable_on_delete` AFTER DELETE ON `users` BEGIN
	DELETE FROM `user_search` WHERE `rowid` = OLD.`id`;
END;
