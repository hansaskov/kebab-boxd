CREATE TABLE `map_cells` (
	`zoom` integer NOT NULL,
	`column` integer NOT NULL,
	`row` integer NOT NULL,
	`count` integer NOT NULL,
	`latitude_sum` real NOT NULL,
	`longitude_sum` real NOT NULL,
	`north` real NOT NULL,
	`south` real NOT NULL,
	`east` real NOT NULL,
	`west` real NOT NULL,
	`best_id` integer NOT NULL,
	`best_rating_avg` real NOT NULL,
	`best_review_count` integer NOT NULL,
	CONSTRAINT `map_cells_pk` PRIMARY KEY(`zoom`, `column`, `row`)
);
--> statement-breakpoint
ALTER TABLE `locations` ADD `map_column` integer GENERATED ALWAYS AS (min(65535, max(0, cast(floor((("longitude" + 180) / 360) * 65536) as integer)))) VIRTUAL;--> statement-breakpoint
ALTER TABLE `locations` ADD `map_row` integer GENERATED ALWAYS AS (min(65535, max(0, cast(floor((0.5 - ln((1 + sin(radians(max(-85.05112878, min(85.05112878, "latitude"))))) / (1 - sin(radians(max(-85.05112878, min(85.05112878, "latitude")))))) / (4 * pi())) * 65536) as integer)))) VIRTUAL;--> statement-breakpoint
CREATE INDEX `locations_map_column_map_row_idx` ON `locations` (`map_column`,`map_row`);
--> statement-breakpoint
-- The map shows the clusters of a zoomed-out view from these cells, so it does not read each restaurant in view. A cell
-- at zoom z holds the approved restaurants of a square 128 pixels wide at that zoom: their count, their middle, their
-- bounds and the best of them. The cells of zoom 15 come from the restaurants, and each coarser cell from its 4 finer
-- cells, so a change of a restaurant refreshes one cell at each zoom.
INSERT INTO `map_cells` (`zoom`, `column`, `row`, `count`, `latitude_sum`, `longitude_sum`, `north`, `south`, `east`, `west`, `best_id`, `best_rating_avg`, `best_review_count`)
SELECT 15, `column`, `row`, `count`, `latitude_sum`, `longitude_sum`, `north`, `south`, `east`, `west`, `best_id`, `best_rating_avg`, `best_review_count`
FROM (
	SELECT
		`locations`.`map_column` AS `column`,
		`locations`.`map_row` AS `row`,
		count(*) OVER `cell` AS `count`,
		sum(`locations`.`latitude`) OVER `cell` AS `latitude_sum`,
		sum(`locations`.`longitude`) OVER `cell` AS `longitude_sum`,
		max(`locations`.`latitude`) OVER `cell` AS `north`,
		min(`locations`.`latitude`) OVER `cell` AS `south`,
		max(`locations`.`longitude`) OVER `cell` AS `east`,
		min(`locations`.`longitude`) OVER `cell` AS `west`,
		`restaurants`.`id` AS `best_id`,
		`restaurants`.`rating_avg` AS `best_rating_avg`,
		`restaurants`.`review_count` AS `best_review_count`,
		row_number() OVER (`cell` ORDER BY `restaurants`.`rating_avg` DESC, `restaurants`.`review_count` DESC, `restaurants`.`id`) AS `rank`
	FROM `locations` JOIN `restaurants` ON `restaurants`.`location_id` = `locations`.`id`
	WHERE `restaurants`.`status` = 'approved'
	WINDOW `cell` AS (PARTITION BY `locations`.`map_column`, `locations`.`map_row`)
)
WHERE `rank` = 1;
--> statement-breakpoint
INSERT INTO `map_cells` (`zoom`, `column`, `row`, `count`, `latitude_sum`, `longitude_sum`, `north`, `south`, `east`, `west`, `best_id`, `best_rating_avg`, `best_review_count`)
SELECT 14, `coarser_column`, `coarser_row`, `count`, `latitude_sum`, `longitude_sum`, `north`, `south`, `east`, `west`, `best_id`, `best_rating_avg`, `best_review_count`
FROM (
	SELECT
		`column` >> 1 AS `coarser_column`,
		`row` >> 1 AS `coarser_row`,
		sum(`count`) OVER `cell` AS `count`,
		sum(`latitude_sum`) OVER `cell` AS `latitude_sum`,
		sum(`longitude_sum`) OVER `cell` AS `longitude_sum`,
		max(`north`) OVER `cell` AS `north`,
		min(`south`) OVER `cell` AS `south`,
		max(`east`) OVER `cell` AS `east`,
		min(`west`) OVER `cell` AS `west`,
		`best_id`,
		`best_rating_avg`,
		`best_review_count`,
		row_number() OVER (`cell` ORDER BY `best_rating_avg` DESC, `best_review_count` DESC, `best_id`) AS `rank`
	FROM `map_cells`
	WHERE `zoom` = 15
	WINDOW `cell` AS (PARTITION BY `column` >> 1, `row` >> 1)
)
WHERE `rank` = 1;
--> statement-breakpoint
INSERT INTO `map_cells` (`zoom`, `column`, `row`, `count`, `latitude_sum`, `longitude_sum`, `north`, `south`, `east`, `west`, `best_id`, `best_rating_avg`, `best_review_count`)
SELECT 13, `coarser_column`, `coarser_row`, `count`, `latitude_sum`, `longitude_sum`, `north`, `south`, `east`, `west`, `best_id`, `best_rating_avg`, `best_review_count`
FROM (
	SELECT
		`column` >> 1 AS `coarser_column`,
		`row` >> 1 AS `coarser_row`,
		sum(`count`) OVER `cell` AS `count`,
		sum(`latitude_sum`) OVER `cell` AS `latitude_sum`,
		sum(`longitude_sum`) OVER `cell` AS `longitude_sum`,
		max(`north`) OVER `cell` AS `north`,
		min(`south`) OVER `cell` AS `south`,
		max(`east`) OVER `cell` AS `east`,
		min(`west`) OVER `cell` AS `west`,
		`best_id`,
		`best_rating_avg`,
		`best_review_count`,
		row_number() OVER (`cell` ORDER BY `best_rating_avg` DESC, `best_review_count` DESC, `best_id`) AS `rank`
	FROM `map_cells`
	WHERE `zoom` = 14
	WINDOW `cell` AS (PARTITION BY `column` >> 1, `row` >> 1)
)
WHERE `rank` = 1;
--> statement-breakpoint
INSERT INTO `map_cells` (`zoom`, `column`, `row`, `count`, `latitude_sum`, `longitude_sum`, `north`, `south`, `east`, `west`, `best_id`, `best_rating_avg`, `best_review_count`)
SELECT 12, `coarser_column`, `coarser_row`, `count`, `latitude_sum`, `longitude_sum`, `north`, `south`, `east`, `west`, `best_id`, `best_rating_avg`, `best_review_count`
FROM (
	SELECT
		`column` >> 1 AS `coarser_column`,
		`row` >> 1 AS `coarser_row`,
		sum(`count`) OVER `cell` AS `count`,
		sum(`latitude_sum`) OVER `cell` AS `latitude_sum`,
		sum(`longitude_sum`) OVER `cell` AS `longitude_sum`,
		max(`north`) OVER `cell` AS `north`,
		min(`south`) OVER `cell` AS `south`,
		max(`east`) OVER `cell` AS `east`,
		min(`west`) OVER `cell` AS `west`,
		`best_id`,
		`best_rating_avg`,
		`best_review_count`,
		row_number() OVER (`cell` ORDER BY `best_rating_avg` DESC, `best_review_count` DESC, `best_id`) AS `rank`
	FROM `map_cells`
	WHERE `zoom` = 13
	WINDOW `cell` AS (PARTITION BY `column` >> 1, `row` >> 1)
)
WHERE `rank` = 1;
--> statement-breakpoint
INSERT INTO `map_cells` (`zoom`, `column`, `row`, `count`, `latitude_sum`, `longitude_sum`, `north`, `south`, `east`, `west`, `best_id`, `best_rating_avg`, `best_review_count`)
SELECT 11, `coarser_column`, `coarser_row`, `count`, `latitude_sum`, `longitude_sum`, `north`, `south`, `east`, `west`, `best_id`, `best_rating_avg`, `best_review_count`
FROM (
	SELECT
		`column` >> 1 AS `coarser_column`,
		`row` >> 1 AS `coarser_row`,
		sum(`count`) OVER `cell` AS `count`,
		sum(`latitude_sum`) OVER `cell` AS `latitude_sum`,
		sum(`longitude_sum`) OVER `cell` AS `longitude_sum`,
		max(`north`) OVER `cell` AS `north`,
		min(`south`) OVER `cell` AS `south`,
		max(`east`) OVER `cell` AS `east`,
		min(`west`) OVER `cell` AS `west`,
		`best_id`,
		`best_rating_avg`,
		`best_review_count`,
		row_number() OVER (`cell` ORDER BY `best_rating_avg` DESC, `best_review_count` DESC, `best_id`) AS `rank`
	FROM `map_cells`
	WHERE `zoom` = 12
	WINDOW `cell` AS (PARTITION BY `column` >> 1, `row` >> 1)
)
WHERE `rank` = 1;
--> statement-breakpoint
INSERT INTO `map_cells` (`zoom`, `column`, `row`, `count`, `latitude_sum`, `longitude_sum`, `north`, `south`, `east`, `west`, `best_id`, `best_rating_avg`, `best_review_count`)
SELECT 10, `coarser_column`, `coarser_row`, `count`, `latitude_sum`, `longitude_sum`, `north`, `south`, `east`, `west`, `best_id`, `best_rating_avg`, `best_review_count`
FROM (
	SELECT
		`column` >> 1 AS `coarser_column`,
		`row` >> 1 AS `coarser_row`,
		sum(`count`) OVER `cell` AS `count`,
		sum(`latitude_sum`) OVER `cell` AS `latitude_sum`,
		sum(`longitude_sum`) OVER `cell` AS `longitude_sum`,
		max(`north`) OVER `cell` AS `north`,
		min(`south`) OVER `cell` AS `south`,
		max(`east`) OVER `cell` AS `east`,
		min(`west`) OVER `cell` AS `west`,
		`best_id`,
		`best_rating_avg`,
		`best_review_count`,
		row_number() OVER (`cell` ORDER BY `best_rating_avg` DESC, `best_review_count` DESC, `best_id`) AS `rank`
	FROM `map_cells`
	WHERE `zoom` = 11
	WINDOW `cell` AS (PARTITION BY `column` >> 1, `row` >> 1)
)
WHERE `rank` = 1;
--> statement-breakpoint
INSERT INTO `map_cells` (`zoom`, `column`, `row`, `count`, `latitude_sum`, `longitude_sum`, `north`, `south`, `east`, `west`, `best_id`, `best_rating_avg`, `best_review_count`)
SELECT 9, `coarser_column`, `coarser_row`, `count`, `latitude_sum`, `longitude_sum`, `north`, `south`, `east`, `west`, `best_id`, `best_rating_avg`, `best_review_count`
FROM (
	SELECT
		`column` >> 1 AS `coarser_column`,
		`row` >> 1 AS `coarser_row`,
		sum(`count`) OVER `cell` AS `count`,
		sum(`latitude_sum`) OVER `cell` AS `latitude_sum`,
		sum(`longitude_sum`) OVER `cell` AS `longitude_sum`,
		max(`north`) OVER `cell` AS `north`,
		min(`south`) OVER `cell` AS `south`,
		max(`east`) OVER `cell` AS `east`,
		min(`west`) OVER `cell` AS `west`,
		`best_id`,
		`best_rating_avg`,
		`best_review_count`,
		row_number() OVER (`cell` ORDER BY `best_rating_avg` DESC, `best_review_count` DESC, `best_id`) AS `rank`
	FROM `map_cells`
	WHERE `zoom` = 10
	WINDOW `cell` AS (PARTITION BY `column` >> 1, `row` >> 1)
)
WHERE `rank` = 1;
--> statement-breakpoint
INSERT INTO `map_cells` (`zoom`, `column`, `row`, `count`, `latitude_sum`, `longitude_sum`, `north`, `south`, `east`, `west`, `best_id`, `best_rating_avg`, `best_review_count`)
SELECT 8, `coarser_column`, `coarser_row`, `count`, `latitude_sum`, `longitude_sum`, `north`, `south`, `east`, `west`, `best_id`, `best_rating_avg`, `best_review_count`
FROM (
	SELECT
		`column` >> 1 AS `coarser_column`,
		`row` >> 1 AS `coarser_row`,
		sum(`count`) OVER `cell` AS `count`,
		sum(`latitude_sum`) OVER `cell` AS `latitude_sum`,
		sum(`longitude_sum`) OVER `cell` AS `longitude_sum`,
		max(`north`) OVER `cell` AS `north`,
		min(`south`) OVER `cell` AS `south`,
		max(`east`) OVER `cell` AS `east`,
		min(`west`) OVER `cell` AS `west`,
		`best_id`,
		`best_rating_avg`,
		`best_review_count`,
		row_number() OVER (`cell` ORDER BY `best_rating_avg` DESC, `best_review_count` DESC, `best_id`) AS `rank`
	FROM `map_cells`
	WHERE `zoom` = 9
	WINDOW `cell` AS (PARTITION BY `column` >> 1, `row` >> 1)
)
WHERE `rank` = 1;
--> statement-breakpoint
INSERT INTO `map_cells` (`zoom`, `column`, `row`, `count`, `latitude_sum`, `longitude_sum`, `north`, `south`, `east`, `west`, `best_id`, `best_rating_avg`, `best_review_count`)
SELECT 7, `coarser_column`, `coarser_row`, `count`, `latitude_sum`, `longitude_sum`, `north`, `south`, `east`, `west`, `best_id`, `best_rating_avg`, `best_review_count`
FROM (
	SELECT
		`column` >> 1 AS `coarser_column`,
		`row` >> 1 AS `coarser_row`,
		sum(`count`) OVER `cell` AS `count`,
		sum(`latitude_sum`) OVER `cell` AS `latitude_sum`,
		sum(`longitude_sum`) OVER `cell` AS `longitude_sum`,
		max(`north`) OVER `cell` AS `north`,
		min(`south`) OVER `cell` AS `south`,
		max(`east`) OVER `cell` AS `east`,
		min(`west`) OVER `cell` AS `west`,
		`best_id`,
		`best_rating_avg`,
		`best_review_count`,
		row_number() OVER (`cell` ORDER BY `best_rating_avg` DESC, `best_review_count` DESC, `best_id`) AS `rank`
	FROM `map_cells`
	WHERE `zoom` = 8
	WINDOW `cell` AS (PARTITION BY `column` >> 1, `row` >> 1)
)
WHERE `rank` = 1;
--> statement-breakpoint
INSERT INTO `map_cells` (`zoom`, `column`, `row`, `count`, `latitude_sum`, `longitude_sum`, `north`, `south`, `east`, `west`, `best_id`, `best_rating_avg`, `best_review_count`)
SELECT 6, `coarser_column`, `coarser_row`, `count`, `latitude_sum`, `longitude_sum`, `north`, `south`, `east`, `west`, `best_id`, `best_rating_avg`, `best_review_count`
FROM (
	SELECT
		`column` >> 1 AS `coarser_column`,
		`row` >> 1 AS `coarser_row`,
		sum(`count`) OVER `cell` AS `count`,
		sum(`latitude_sum`) OVER `cell` AS `latitude_sum`,
		sum(`longitude_sum`) OVER `cell` AS `longitude_sum`,
		max(`north`) OVER `cell` AS `north`,
		min(`south`) OVER `cell` AS `south`,
		max(`east`) OVER `cell` AS `east`,
		min(`west`) OVER `cell` AS `west`,
		`best_id`,
		`best_rating_avg`,
		`best_review_count`,
		row_number() OVER (`cell` ORDER BY `best_rating_avg` DESC, `best_review_count` DESC, `best_id`) AS `rank`
	FROM `map_cells`
	WHERE `zoom` = 7
	WINDOW `cell` AS (PARTITION BY `column` >> 1, `row` >> 1)
)
WHERE `rank` = 1;
--> statement-breakpoint
INSERT INTO `map_cells` (`zoom`, `column`, `row`, `count`, `latitude_sum`, `longitude_sum`, `north`, `south`, `east`, `west`, `best_id`, `best_rating_avg`, `best_review_count`)
SELECT 5, `coarser_column`, `coarser_row`, `count`, `latitude_sum`, `longitude_sum`, `north`, `south`, `east`, `west`, `best_id`, `best_rating_avg`, `best_review_count`
FROM (
	SELECT
		`column` >> 1 AS `coarser_column`,
		`row` >> 1 AS `coarser_row`,
		sum(`count`) OVER `cell` AS `count`,
		sum(`latitude_sum`) OVER `cell` AS `latitude_sum`,
		sum(`longitude_sum`) OVER `cell` AS `longitude_sum`,
		max(`north`) OVER `cell` AS `north`,
		min(`south`) OVER `cell` AS `south`,
		max(`east`) OVER `cell` AS `east`,
		min(`west`) OVER `cell` AS `west`,
		`best_id`,
		`best_rating_avg`,
		`best_review_count`,
		row_number() OVER (`cell` ORDER BY `best_rating_avg` DESC, `best_review_count` DESC, `best_id`) AS `rank`
	FROM `map_cells`
	WHERE `zoom` = 6
	WINDOW `cell` AS (PARTITION BY `column` >> 1, `row` >> 1)
)
WHERE `rank` = 1;
--> statement-breakpoint
CREATE VIEW `map_cell_refreshes` AS SELECT NULL AS `column`, NULL AS `row` WHERE 0;
--> statement-breakpoint
CREATE TRIGGER `map_cells_refreshed` INSTEAD OF INSERT ON `map_cell_refreshes` BEGIN
	DELETE FROM `map_cells` WHERE `zoom` = 15 AND `column` = NEW.`column` AND `row` = NEW.`row`;
	INSERT INTO `map_cells` (`zoom`, `column`, `row`, `count`, `latitude_sum`, `longitude_sum`, `north`, `south`, `east`, `west`, `best_id`, `best_rating_avg`, `best_review_count`)
	SELECT 15, NEW.`column`, NEW.`row`, `cell`.*, `best`.*
	FROM (
		SELECT count(*), sum(`locations`.`latitude`), sum(`locations`.`longitude`),
			max(`locations`.`latitude`), min(`locations`.`latitude`), max(`locations`.`longitude`), min(`locations`.`longitude`)
		FROM `locations` CROSS JOIN `restaurants` ON `restaurants`.`location_id` = `locations`.`id`
		WHERE `locations`.`map_column` = NEW.`column` AND `locations`.`map_row` = NEW.`row` AND +`restaurants`.`status` = 'approved'
	) AS `cell`, (
		SELECT `restaurants`.`id`, `restaurants`.`rating_avg`, `restaurants`.`review_count`
		FROM `locations` CROSS JOIN `restaurants` ON `restaurants`.`location_id` = `locations`.`id`
		WHERE `locations`.`map_column` = NEW.`column` AND `locations`.`map_row` = NEW.`row` AND +`restaurants`.`status` = 'approved'
		ORDER BY `restaurants`.`rating_avg` DESC, `restaurants`.`review_count` DESC, `restaurants`.`id`
		LIMIT 1
	) AS `best`;
	DELETE FROM `map_cells` WHERE `zoom` = 14 AND `column` = NEW.`column` >> 1 AND `row` = NEW.`row` >> 1;
	INSERT INTO `map_cells` (`zoom`, `column`, `row`, `count`, `latitude_sum`, `longitude_sum`, `north`, `south`, `east`, `west`, `best_id`, `best_rating_avg`, `best_review_count`)
	SELECT 14, NEW.`column` >> 1, NEW.`row` >> 1, `cell`.*, `best`.*
	FROM (
		SELECT sum(`count`), sum(`latitude_sum`), sum(`longitude_sum`), max(`north`), min(`south`), max(`east`), min(`west`)
		FROM `map_cells` WHERE `zoom` = 15 AND `column` IN ((NEW.`column` >> 1) * 2, (NEW.`column` >> 1) * 2 + 1) AND `row` IN ((NEW.`row` >> 1) * 2, (NEW.`row` >> 1) * 2 + 1)
	) AS `cell`, (
		SELECT `best_id`, `best_rating_avg`, `best_review_count`
		FROM `map_cells` WHERE `zoom` = 15 AND `column` IN ((NEW.`column` >> 1) * 2, (NEW.`column` >> 1) * 2 + 1) AND `row` IN ((NEW.`row` >> 1) * 2, (NEW.`row` >> 1) * 2 + 1)
		ORDER BY `best_rating_avg` DESC, `best_review_count` DESC, `best_id`
		LIMIT 1
	) AS `best`;
	DELETE FROM `map_cells` WHERE `zoom` = 13 AND `column` = NEW.`column` >> 2 AND `row` = NEW.`row` >> 2;
	INSERT INTO `map_cells` (`zoom`, `column`, `row`, `count`, `latitude_sum`, `longitude_sum`, `north`, `south`, `east`, `west`, `best_id`, `best_rating_avg`, `best_review_count`)
	SELECT 13, NEW.`column` >> 2, NEW.`row` >> 2, `cell`.*, `best`.*
	FROM (
		SELECT sum(`count`), sum(`latitude_sum`), sum(`longitude_sum`), max(`north`), min(`south`), max(`east`), min(`west`)
		FROM `map_cells` WHERE `zoom` = 14 AND `column` IN ((NEW.`column` >> 2) * 2, (NEW.`column` >> 2) * 2 + 1) AND `row` IN ((NEW.`row` >> 2) * 2, (NEW.`row` >> 2) * 2 + 1)
	) AS `cell`, (
		SELECT `best_id`, `best_rating_avg`, `best_review_count`
		FROM `map_cells` WHERE `zoom` = 14 AND `column` IN ((NEW.`column` >> 2) * 2, (NEW.`column` >> 2) * 2 + 1) AND `row` IN ((NEW.`row` >> 2) * 2, (NEW.`row` >> 2) * 2 + 1)
		ORDER BY `best_rating_avg` DESC, `best_review_count` DESC, `best_id`
		LIMIT 1
	) AS `best`;
	DELETE FROM `map_cells` WHERE `zoom` = 12 AND `column` = NEW.`column` >> 3 AND `row` = NEW.`row` >> 3;
	INSERT INTO `map_cells` (`zoom`, `column`, `row`, `count`, `latitude_sum`, `longitude_sum`, `north`, `south`, `east`, `west`, `best_id`, `best_rating_avg`, `best_review_count`)
	SELECT 12, NEW.`column` >> 3, NEW.`row` >> 3, `cell`.*, `best`.*
	FROM (
		SELECT sum(`count`), sum(`latitude_sum`), sum(`longitude_sum`), max(`north`), min(`south`), max(`east`), min(`west`)
		FROM `map_cells` WHERE `zoom` = 13 AND `column` IN ((NEW.`column` >> 3) * 2, (NEW.`column` >> 3) * 2 + 1) AND `row` IN ((NEW.`row` >> 3) * 2, (NEW.`row` >> 3) * 2 + 1)
	) AS `cell`, (
		SELECT `best_id`, `best_rating_avg`, `best_review_count`
		FROM `map_cells` WHERE `zoom` = 13 AND `column` IN ((NEW.`column` >> 3) * 2, (NEW.`column` >> 3) * 2 + 1) AND `row` IN ((NEW.`row` >> 3) * 2, (NEW.`row` >> 3) * 2 + 1)
		ORDER BY `best_rating_avg` DESC, `best_review_count` DESC, `best_id`
		LIMIT 1
	) AS `best`;
	DELETE FROM `map_cells` WHERE `zoom` = 11 AND `column` = NEW.`column` >> 4 AND `row` = NEW.`row` >> 4;
	INSERT INTO `map_cells` (`zoom`, `column`, `row`, `count`, `latitude_sum`, `longitude_sum`, `north`, `south`, `east`, `west`, `best_id`, `best_rating_avg`, `best_review_count`)
	SELECT 11, NEW.`column` >> 4, NEW.`row` >> 4, `cell`.*, `best`.*
	FROM (
		SELECT sum(`count`), sum(`latitude_sum`), sum(`longitude_sum`), max(`north`), min(`south`), max(`east`), min(`west`)
		FROM `map_cells` WHERE `zoom` = 12 AND `column` IN ((NEW.`column` >> 4) * 2, (NEW.`column` >> 4) * 2 + 1) AND `row` IN ((NEW.`row` >> 4) * 2, (NEW.`row` >> 4) * 2 + 1)
	) AS `cell`, (
		SELECT `best_id`, `best_rating_avg`, `best_review_count`
		FROM `map_cells` WHERE `zoom` = 12 AND `column` IN ((NEW.`column` >> 4) * 2, (NEW.`column` >> 4) * 2 + 1) AND `row` IN ((NEW.`row` >> 4) * 2, (NEW.`row` >> 4) * 2 + 1)
		ORDER BY `best_rating_avg` DESC, `best_review_count` DESC, `best_id`
		LIMIT 1
	) AS `best`;
	DELETE FROM `map_cells` WHERE `zoom` = 10 AND `column` = NEW.`column` >> 5 AND `row` = NEW.`row` >> 5;
	INSERT INTO `map_cells` (`zoom`, `column`, `row`, `count`, `latitude_sum`, `longitude_sum`, `north`, `south`, `east`, `west`, `best_id`, `best_rating_avg`, `best_review_count`)
	SELECT 10, NEW.`column` >> 5, NEW.`row` >> 5, `cell`.*, `best`.*
	FROM (
		SELECT sum(`count`), sum(`latitude_sum`), sum(`longitude_sum`), max(`north`), min(`south`), max(`east`), min(`west`)
		FROM `map_cells` WHERE `zoom` = 11 AND `column` IN ((NEW.`column` >> 5) * 2, (NEW.`column` >> 5) * 2 + 1) AND `row` IN ((NEW.`row` >> 5) * 2, (NEW.`row` >> 5) * 2 + 1)
	) AS `cell`, (
		SELECT `best_id`, `best_rating_avg`, `best_review_count`
		FROM `map_cells` WHERE `zoom` = 11 AND `column` IN ((NEW.`column` >> 5) * 2, (NEW.`column` >> 5) * 2 + 1) AND `row` IN ((NEW.`row` >> 5) * 2, (NEW.`row` >> 5) * 2 + 1)
		ORDER BY `best_rating_avg` DESC, `best_review_count` DESC, `best_id`
		LIMIT 1
	) AS `best`;
	DELETE FROM `map_cells` WHERE `zoom` = 9 AND `column` = NEW.`column` >> 6 AND `row` = NEW.`row` >> 6;
	INSERT INTO `map_cells` (`zoom`, `column`, `row`, `count`, `latitude_sum`, `longitude_sum`, `north`, `south`, `east`, `west`, `best_id`, `best_rating_avg`, `best_review_count`)
	SELECT 9, NEW.`column` >> 6, NEW.`row` >> 6, `cell`.*, `best`.*
	FROM (
		SELECT sum(`count`), sum(`latitude_sum`), sum(`longitude_sum`), max(`north`), min(`south`), max(`east`), min(`west`)
		FROM `map_cells` WHERE `zoom` = 10 AND `column` IN ((NEW.`column` >> 6) * 2, (NEW.`column` >> 6) * 2 + 1) AND `row` IN ((NEW.`row` >> 6) * 2, (NEW.`row` >> 6) * 2 + 1)
	) AS `cell`, (
		SELECT `best_id`, `best_rating_avg`, `best_review_count`
		FROM `map_cells` WHERE `zoom` = 10 AND `column` IN ((NEW.`column` >> 6) * 2, (NEW.`column` >> 6) * 2 + 1) AND `row` IN ((NEW.`row` >> 6) * 2, (NEW.`row` >> 6) * 2 + 1)
		ORDER BY `best_rating_avg` DESC, `best_review_count` DESC, `best_id`
		LIMIT 1
	) AS `best`;
	DELETE FROM `map_cells` WHERE `zoom` = 8 AND `column` = NEW.`column` >> 7 AND `row` = NEW.`row` >> 7;
	INSERT INTO `map_cells` (`zoom`, `column`, `row`, `count`, `latitude_sum`, `longitude_sum`, `north`, `south`, `east`, `west`, `best_id`, `best_rating_avg`, `best_review_count`)
	SELECT 8, NEW.`column` >> 7, NEW.`row` >> 7, `cell`.*, `best`.*
	FROM (
		SELECT sum(`count`), sum(`latitude_sum`), sum(`longitude_sum`), max(`north`), min(`south`), max(`east`), min(`west`)
		FROM `map_cells` WHERE `zoom` = 9 AND `column` IN ((NEW.`column` >> 7) * 2, (NEW.`column` >> 7) * 2 + 1) AND `row` IN ((NEW.`row` >> 7) * 2, (NEW.`row` >> 7) * 2 + 1)
	) AS `cell`, (
		SELECT `best_id`, `best_rating_avg`, `best_review_count`
		FROM `map_cells` WHERE `zoom` = 9 AND `column` IN ((NEW.`column` >> 7) * 2, (NEW.`column` >> 7) * 2 + 1) AND `row` IN ((NEW.`row` >> 7) * 2, (NEW.`row` >> 7) * 2 + 1)
		ORDER BY `best_rating_avg` DESC, `best_review_count` DESC, `best_id`
		LIMIT 1
	) AS `best`;
	DELETE FROM `map_cells` WHERE `zoom` = 7 AND `column` = NEW.`column` >> 8 AND `row` = NEW.`row` >> 8;
	INSERT INTO `map_cells` (`zoom`, `column`, `row`, `count`, `latitude_sum`, `longitude_sum`, `north`, `south`, `east`, `west`, `best_id`, `best_rating_avg`, `best_review_count`)
	SELECT 7, NEW.`column` >> 8, NEW.`row` >> 8, `cell`.*, `best`.*
	FROM (
		SELECT sum(`count`), sum(`latitude_sum`), sum(`longitude_sum`), max(`north`), min(`south`), max(`east`), min(`west`)
		FROM `map_cells` WHERE `zoom` = 8 AND `column` IN ((NEW.`column` >> 8) * 2, (NEW.`column` >> 8) * 2 + 1) AND `row` IN ((NEW.`row` >> 8) * 2, (NEW.`row` >> 8) * 2 + 1)
	) AS `cell`, (
		SELECT `best_id`, `best_rating_avg`, `best_review_count`
		FROM `map_cells` WHERE `zoom` = 8 AND `column` IN ((NEW.`column` >> 8) * 2, (NEW.`column` >> 8) * 2 + 1) AND `row` IN ((NEW.`row` >> 8) * 2, (NEW.`row` >> 8) * 2 + 1)
		ORDER BY `best_rating_avg` DESC, `best_review_count` DESC, `best_id`
		LIMIT 1
	) AS `best`;
	DELETE FROM `map_cells` WHERE `zoom` = 6 AND `column` = NEW.`column` >> 9 AND `row` = NEW.`row` >> 9;
	INSERT INTO `map_cells` (`zoom`, `column`, `row`, `count`, `latitude_sum`, `longitude_sum`, `north`, `south`, `east`, `west`, `best_id`, `best_rating_avg`, `best_review_count`)
	SELECT 6, NEW.`column` >> 9, NEW.`row` >> 9, `cell`.*, `best`.*
	FROM (
		SELECT sum(`count`), sum(`latitude_sum`), sum(`longitude_sum`), max(`north`), min(`south`), max(`east`), min(`west`)
		FROM `map_cells` WHERE `zoom` = 7 AND `column` IN ((NEW.`column` >> 9) * 2, (NEW.`column` >> 9) * 2 + 1) AND `row` IN ((NEW.`row` >> 9) * 2, (NEW.`row` >> 9) * 2 + 1)
	) AS `cell`, (
		SELECT `best_id`, `best_rating_avg`, `best_review_count`
		FROM `map_cells` WHERE `zoom` = 7 AND `column` IN ((NEW.`column` >> 9) * 2, (NEW.`column` >> 9) * 2 + 1) AND `row` IN ((NEW.`row` >> 9) * 2, (NEW.`row` >> 9) * 2 + 1)
		ORDER BY `best_rating_avg` DESC, `best_review_count` DESC, `best_id`
		LIMIT 1
	) AS `best`;
	DELETE FROM `map_cells` WHERE `zoom` = 5 AND `column` = NEW.`column` >> 10 AND `row` = NEW.`row` >> 10;
	INSERT INTO `map_cells` (`zoom`, `column`, `row`, `count`, `latitude_sum`, `longitude_sum`, `north`, `south`, `east`, `west`, `best_id`, `best_rating_avg`, `best_review_count`)
	SELECT 5, NEW.`column` >> 10, NEW.`row` >> 10, `cell`.*, `best`.*
	FROM (
		SELECT sum(`count`), sum(`latitude_sum`), sum(`longitude_sum`), max(`north`), min(`south`), max(`east`), min(`west`)
		FROM `map_cells` WHERE `zoom` = 6 AND `column` IN ((NEW.`column` >> 10) * 2, (NEW.`column` >> 10) * 2 + 1) AND `row` IN ((NEW.`row` >> 10) * 2, (NEW.`row` >> 10) * 2 + 1)
	) AS `cell`, (
		SELECT `best_id`, `best_rating_avg`, `best_review_count`
		FROM `map_cells` WHERE `zoom` = 6 AND `column` IN ((NEW.`column` >> 10) * 2, (NEW.`column` >> 10) * 2 + 1) AND `row` IN ((NEW.`row` >> 10) * 2, (NEW.`row` >> 10) * 2 + 1)
		ORDER BY `best_rating_avg` DESC, `best_review_count` DESC, `best_id`
		LIMIT 1
	) AS `best`;
END;
--> statement-breakpoint
CREATE VIEW `map_cell_additions` AS SELECT NULL AS `column`, NULL AS `row`, NULL AS `latitude`, NULL AS `longitude`, NULL AS `id`, NULL AS `rating_avg`, NULL AS `review_count` WHERE 0;
--> statement-breakpoint
CREATE TRIGGER `map_cells_added_to` INSTEAD OF INSERT ON `map_cell_additions` BEGIN
	INSERT INTO `map_cells` (`zoom`, `column`, `row`, `count`, `latitude_sum`, `longitude_sum`, `north`, `south`, `east`, `west`, `best_id`, `best_rating_avg`, `best_review_count`)
	VALUES (15, NEW.`column`, NEW.`row`, 1, NEW.`latitude`, NEW.`longitude`, NEW.`latitude`, NEW.`latitude`, NEW.`longitude`, NEW.`longitude`, NEW.`id`, NEW.`rating_avg`, NEW.`review_count`)
	ON CONFLICT (`zoom`, `column`, `row`) DO UPDATE SET
		`count` = `count` + 1,
		`latitude_sum` = `latitude_sum` + excluded.`latitude_sum`,
		`longitude_sum` = `longitude_sum` + excluded.`longitude_sum`,
		`north` = max(`north`, excluded.`north`),
		`south` = min(`south`, excluded.`south`),
		`east` = max(`east`, excluded.`east`),
		`west` = min(`west`, excluded.`west`),
		(`best_id`, `best_rating_avg`, `best_review_count`) = (
			SELECT `id`, `rating_avg`, `review_count` FROM (
				SELECT `best_id` AS `id`, `best_rating_avg` AS `rating_avg`, `best_review_count` AS `review_count`
				UNION ALL SELECT excluded.`best_id`, excluded.`best_rating_avg`, excluded.`best_review_count`
			)
			ORDER BY `rating_avg` DESC, `review_count` DESC, `id`
			LIMIT 1
		);
	INSERT INTO `map_cells` (`zoom`, `column`, `row`, `count`, `latitude_sum`, `longitude_sum`, `north`, `south`, `east`, `west`, `best_id`, `best_rating_avg`, `best_review_count`)
	VALUES (14, NEW.`column` >> 1, NEW.`row` >> 1, 1, NEW.`latitude`, NEW.`longitude`, NEW.`latitude`, NEW.`latitude`, NEW.`longitude`, NEW.`longitude`, NEW.`id`, NEW.`rating_avg`, NEW.`review_count`)
	ON CONFLICT (`zoom`, `column`, `row`) DO UPDATE SET
		`count` = `count` + 1,
		`latitude_sum` = `latitude_sum` + excluded.`latitude_sum`,
		`longitude_sum` = `longitude_sum` + excluded.`longitude_sum`,
		`north` = max(`north`, excluded.`north`),
		`south` = min(`south`, excluded.`south`),
		`east` = max(`east`, excluded.`east`),
		`west` = min(`west`, excluded.`west`),
		(`best_id`, `best_rating_avg`, `best_review_count`) = (
			SELECT `id`, `rating_avg`, `review_count` FROM (
				SELECT `best_id` AS `id`, `best_rating_avg` AS `rating_avg`, `best_review_count` AS `review_count`
				UNION ALL SELECT excluded.`best_id`, excluded.`best_rating_avg`, excluded.`best_review_count`
			)
			ORDER BY `rating_avg` DESC, `review_count` DESC, `id`
			LIMIT 1
		);
	INSERT INTO `map_cells` (`zoom`, `column`, `row`, `count`, `latitude_sum`, `longitude_sum`, `north`, `south`, `east`, `west`, `best_id`, `best_rating_avg`, `best_review_count`)
	VALUES (13, NEW.`column` >> 2, NEW.`row` >> 2, 1, NEW.`latitude`, NEW.`longitude`, NEW.`latitude`, NEW.`latitude`, NEW.`longitude`, NEW.`longitude`, NEW.`id`, NEW.`rating_avg`, NEW.`review_count`)
	ON CONFLICT (`zoom`, `column`, `row`) DO UPDATE SET
		`count` = `count` + 1,
		`latitude_sum` = `latitude_sum` + excluded.`latitude_sum`,
		`longitude_sum` = `longitude_sum` + excluded.`longitude_sum`,
		`north` = max(`north`, excluded.`north`),
		`south` = min(`south`, excluded.`south`),
		`east` = max(`east`, excluded.`east`),
		`west` = min(`west`, excluded.`west`),
		(`best_id`, `best_rating_avg`, `best_review_count`) = (
			SELECT `id`, `rating_avg`, `review_count` FROM (
				SELECT `best_id` AS `id`, `best_rating_avg` AS `rating_avg`, `best_review_count` AS `review_count`
				UNION ALL SELECT excluded.`best_id`, excluded.`best_rating_avg`, excluded.`best_review_count`
			)
			ORDER BY `rating_avg` DESC, `review_count` DESC, `id`
			LIMIT 1
		);
	INSERT INTO `map_cells` (`zoom`, `column`, `row`, `count`, `latitude_sum`, `longitude_sum`, `north`, `south`, `east`, `west`, `best_id`, `best_rating_avg`, `best_review_count`)
	VALUES (12, NEW.`column` >> 3, NEW.`row` >> 3, 1, NEW.`latitude`, NEW.`longitude`, NEW.`latitude`, NEW.`latitude`, NEW.`longitude`, NEW.`longitude`, NEW.`id`, NEW.`rating_avg`, NEW.`review_count`)
	ON CONFLICT (`zoom`, `column`, `row`) DO UPDATE SET
		`count` = `count` + 1,
		`latitude_sum` = `latitude_sum` + excluded.`latitude_sum`,
		`longitude_sum` = `longitude_sum` + excluded.`longitude_sum`,
		`north` = max(`north`, excluded.`north`),
		`south` = min(`south`, excluded.`south`),
		`east` = max(`east`, excluded.`east`),
		`west` = min(`west`, excluded.`west`),
		(`best_id`, `best_rating_avg`, `best_review_count`) = (
			SELECT `id`, `rating_avg`, `review_count` FROM (
				SELECT `best_id` AS `id`, `best_rating_avg` AS `rating_avg`, `best_review_count` AS `review_count`
				UNION ALL SELECT excluded.`best_id`, excluded.`best_rating_avg`, excluded.`best_review_count`
			)
			ORDER BY `rating_avg` DESC, `review_count` DESC, `id`
			LIMIT 1
		);
	INSERT INTO `map_cells` (`zoom`, `column`, `row`, `count`, `latitude_sum`, `longitude_sum`, `north`, `south`, `east`, `west`, `best_id`, `best_rating_avg`, `best_review_count`)
	VALUES (11, NEW.`column` >> 4, NEW.`row` >> 4, 1, NEW.`latitude`, NEW.`longitude`, NEW.`latitude`, NEW.`latitude`, NEW.`longitude`, NEW.`longitude`, NEW.`id`, NEW.`rating_avg`, NEW.`review_count`)
	ON CONFLICT (`zoom`, `column`, `row`) DO UPDATE SET
		`count` = `count` + 1,
		`latitude_sum` = `latitude_sum` + excluded.`latitude_sum`,
		`longitude_sum` = `longitude_sum` + excluded.`longitude_sum`,
		`north` = max(`north`, excluded.`north`),
		`south` = min(`south`, excluded.`south`),
		`east` = max(`east`, excluded.`east`),
		`west` = min(`west`, excluded.`west`),
		(`best_id`, `best_rating_avg`, `best_review_count`) = (
			SELECT `id`, `rating_avg`, `review_count` FROM (
				SELECT `best_id` AS `id`, `best_rating_avg` AS `rating_avg`, `best_review_count` AS `review_count`
				UNION ALL SELECT excluded.`best_id`, excluded.`best_rating_avg`, excluded.`best_review_count`
			)
			ORDER BY `rating_avg` DESC, `review_count` DESC, `id`
			LIMIT 1
		);
	INSERT INTO `map_cells` (`zoom`, `column`, `row`, `count`, `latitude_sum`, `longitude_sum`, `north`, `south`, `east`, `west`, `best_id`, `best_rating_avg`, `best_review_count`)
	VALUES (10, NEW.`column` >> 5, NEW.`row` >> 5, 1, NEW.`latitude`, NEW.`longitude`, NEW.`latitude`, NEW.`latitude`, NEW.`longitude`, NEW.`longitude`, NEW.`id`, NEW.`rating_avg`, NEW.`review_count`)
	ON CONFLICT (`zoom`, `column`, `row`) DO UPDATE SET
		`count` = `count` + 1,
		`latitude_sum` = `latitude_sum` + excluded.`latitude_sum`,
		`longitude_sum` = `longitude_sum` + excluded.`longitude_sum`,
		`north` = max(`north`, excluded.`north`),
		`south` = min(`south`, excluded.`south`),
		`east` = max(`east`, excluded.`east`),
		`west` = min(`west`, excluded.`west`),
		(`best_id`, `best_rating_avg`, `best_review_count`) = (
			SELECT `id`, `rating_avg`, `review_count` FROM (
				SELECT `best_id` AS `id`, `best_rating_avg` AS `rating_avg`, `best_review_count` AS `review_count`
				UNION ALL SELECT excluded.`best_id`, excluded.`best_rating_avg`, excluded.`best_review_count`
			)
			ORDER BY `rating_avg` DESC, `review_count` DESC, `id`
			LIMIT 1
		);
	INSERT INTO `map_cells` (`zoom`, `column`, `row`, `count`, `latitude_sum`, `longitude_sum`, `north`, `south`, `east`, `west`, `best_id`, `best_rating_avg`, `best_review_count`)
	VALUES (9, NEW.`column` >> 6, NEW.`row` >> 6, 1, NEW.`latitude`, NEW.`longitude`, NEW.`latitude`, NEW.`latitude`, NEW.`longitude`, NEW.`longitude`, NEW.`id`, NEW.`rating_avg`, NEW.`review_count`)
	ON CONFLICT (`zoom`, `column`, `row`) DO UPDATE SET
		`count` = `count` + 1,
		`latitude_sum` = `latitude_sum` + excluded.`latitude_sum`,
		`longitude_sum` = `longitude_sum` + excluded.`longitude_sum`,
		`north` = max(`north`, excluded.`north`),
		`south` = min(`south`, excluded.`south`),
		`east` = max(`east`, excluded.`east`),
		`west` = min(`west`, excluded.`west`),
		(`best_id`, `best_rating_avg`, `best_review_count`) = (
			SELECT `id`, `rating_avg`, `review_count` FROM (
				SELECT `best_id` AS `id`, `best_rating_avg` AS `rating_avg`, `best_review_count` AS `review_count`
				UNION ALL SELECT excluded.`best_id`, excluded.`best_rating_avg`, excluded.`best_review_count`
			)
			ORDER BY `rating_avg` DESC, `review_count` DESC, `id`
			LIMIT 1
		);
	INSERT INTO `map_cells` (`zoom`, `column`, `row`, `count`, `latitude_sum`, `longitude_sum`, `north`, `south`, `east`, `west`, `best_id`, `best_rating_avg`, `best_review_count`)
	VALUES (8, NEW.`column` >> 7, NEW.`row` >> 7, 1, NEW.`latitude`, NEW.`longitude`, NEW.`latitude`, NEW.`latitude`, NEW.`longitude`, NEW.`longitude`, NEW.`id`, NEW.`rating_avg`, NEW.`review_count`)
	ON CONFLICT (`zoom`, `column`, `row`) DO UPDATE SET
		`count` = `count` + 1,
		`latitude_sum` = `latitude_sum` + excluded.`latitude_sum`,
		`longitude_sum` = `longitude_sum` + excluded.`longitude_sum`,
		`north` = max(`north`, excluded.`north`),
		`south` = min(`south`, excluded.`south`),
		`east` = max(`east`, excluded.`east`),
		`west` = min(`west`, excluded.`west`),
		(`best_id`, `best_rating_avg`, `best_review_count`) = (
			SELECT `id`, `rating_avg`, `review_count` FROM (
				SELECT `best_id` AS `id`, `best_rating_avg` AS `rating_avg`, `best_review_count` AS `review_count`
				UNION ALL SELECT excluded.`best_id`, excluded.`best_rating_avg`, excluded.`best_review_count`
			)
			ORDER BY `rating_avg` DESC, `review_count` DESC, `id`
			LIMIT 1
		);
	INSERT INTO `map_cells` (`zoom`, `column`, `row`, `count`, `latitude_sum`, `longitude_sum`, `north`, `south`, `east`, `west`, `best_id`, `best_rating_avg`, `best_review_count`)
	VALUES (7, NEW.`column` >> 8, NEW.`row` >> 8, 1, NEW.`latitude`, NEW.`longitude`, NEW.`latitude`, NEW.`latitude`, NEW.`longitude`, NEW.`longitude`, NEW.`id`, NEW.`rating_avg`, NEW.`review_count`)
	ON CONFLICT (`zoom`, `column`, `row`) DO UPDATE SET
		`count` = `count` + 1,
		`latitude_sum` = `latitude_sum` + excluded.`latitude_sum`,
		`longitude_sum` = `longitude_sum` + excluded.`longitude_sum`,
		`north` = max(`north`, excluded.`north`),
		`south` = min(`south`, excluded.`south`),
		`east` = max(`east`, excluded.`east`),
		`west` = min(`west`, excluded.`west`),
		(`best_id`, `best_rating_avg`, `best_review_count`) = (
			SELECT `id`, `rating_avg`, `review_count` FROM (
				SELECT `best_id` AS `id`, `best_rating_avg` AS `rating_avg`, `best_review_count` AS `review_count`
				UNION ALL SELECT excluded.`best_id`, excluded.`best_rating_avg`, excluded.`best_review_count`
			)
			ORDER BY `rating_avg` DESC, `review_count` DESC, `id`
			LIMIT 1
		);
	INSERT INTO `map_cells` (`zoom`, `column`, `row`, `count`, `latitude_sum`, `longitude_sum`, `north`, `south`, `east`, `west`, `best_id`, `best_rating_avg`, `best_review_count`)
	VALUES (6, NEW.`column` >> 9, NEW.`row` >> 9, 1, NEW.`latitude`, NEW.`longitude`, NEW.`latitude`, NEW.`latitude`, NEW.`longitude`, NEW.`longitude`, NEW.`id`, NEW.`rating_avg`, NEW.`review_count`)
	ON CONFLICT (`zoom`, `column`, `row`) DO UPDATE SET
		`count` = `count` + 1,
		`latitude_sum` = `latitude_sum` + excluded.`latitude_sum`,
		`longitude_sum` = `longitude_sum` + excluded.`longitude_sum`,
		`north` = max(`north`, excluded.`north`),
		`south` = min(`south`, excluded.`south`),
		`east` = max(`east`, excluded.`east`),
		`west` = min(`west`, excluded.`west`),
		(`best_id`, `best_rating_avg`, `best_review_count`) = (
			SELECT `id`, `rating_avg`, `review_count` FROM (
				SELECT `best_id` AS `id`, `best_rating_avg` AS `rating_avg`, `best_review_count` AS `review_count`
				UNION ALL SELECT excluded.`best_id`, excluded.`best_rating_avg`, excluded.`best_review_count`
			)
			ORDER BY `rating_avg` DESC, `review_count` DESC, `id`
			LIMIT 1
		);
	INSERT INTO `map_cells` (`zoom`, `column`, `row`, `count`, `latitude_sum`, `longitude_sum`, `north`, `south`, `east`, `west`, `best_id`, `best_rating_avg`, `best_review_count`)
	VALUES (5, NEW.`column` >> 10, NEW.`row` >> 10, 1, NEW.`latitude`, NEW.`longitude`, NEW.`latitude`, NEW.`latitude`, NEW.`longitude`, NEW.`longitude`, NEW.`id`, NEW.`rating_avg`, NEW.`review_count`)
	ON CONFLICT (`zoom`, `column`, `row`) DO UPDATE SET
		`count` = `count` + 1,
		`latitude_sum` = `latitude_sum` + excluded.`latitude_sum`,
		`longitude_sum` = `longitude_sum` + excluded.`longitude_sum`,
		`north` = max(`north`, excluded.`north`),
		`south` = min(`south`, excluded.`south`),
		`east` = max(`east`, excluded.`east`),
		`west` = min(`west`, excluded.`west`),
		(`best_id`, `best_rating_avg`, `best_review_count`) = (
			SELECT `id`, `rating_avg`, `review_count` FROM (
				SELECT `best_id` AS `id`, `best_rating_avg` AS `rating_avg`, `best_review_count` AS `review_count`
				UNION ALL SELECT excluded.`best_id`, excluded.`best_rating_avg`, excluded.`best_review_count`
			)
			ORDER BY `rating_avg` DESC, `review_count` DESC, `id`
			LIMIT 1
		);
END;
--> statement-breakpoint
CREATE TRIGGER `restaurants_mapped_on_insert` AFTER INSERT ON `restaurants` WHEN NEW.`status` = 'approved' BEGIN
	INSERT INTO `map_cell_additions` (`column`, `row`, `latitude`, `longitude`, `id`, `rating_avg`, `review_count`)
	SELECT `map_column`, `map_row`, `latitude`, `longitude`, NEW.`id`, NEW.`rating_avg`, NEW.`review_count` FROM `locations` WHERE `id` = NEW.`location_id`;
END;
--> statement-breakpoint
CREATE TRIGGER `restaurants_mapped_on_approval` AFTER UPDATE OF `status` ON `restaurants`
WHEN OLD.`status` IS NOT 'approved' AND NEW.`status` = 'approved' BEGIN
	INSERT INTO `map_cell_additions` (`column`, `row`, `latitude`, `longitude`, `id`, `rating_avg`, `review_count`)
	SELECT `map_column`, `map_row`, `latitude`, `longitude`, NEW.`id`, NEW.`rating_avg`, NEW.`review_count` FROM `locations` WHERE `id` = NEW.`location_id`;
END;
--> statement-breakpoint
CREATE TRIGGER `restaurants_mapped_on_update` AFTER UPDATE OF `status`, `rating_avg`, `review_count`, `location_id` ON `restaurants`
WHEN OLD.`status` = 'approved' AND (
	OLD.`status` IS NOT NEW.`status` OR OLD.`rating_avg` IS NOT NEW.`rating_avg`
	OR OLD.`review_count` IS NOT NEW.`review_count` OR OLD.`location_id` IS NOT NEW.`location_id`
) BEGIN
	INSERT INTO `map_cell_refreshes` (`column`, `row`)
	SELECT DISTINCT `map_column`, `map_row` FROM `locations` WHERE `id` IN (OLD.`location_id`, NEW.`location_id`);
END;
--> statement-breakpoint
CREATE TRIGGER `restaurants_mapped_on_delete` AFTER DELETE ON `restaurants` WHEN OLD.`status` = 'approved' BEGIN
	INSERT INTO `map_cell_refreshes` (`column`, `row`) SELECT `map_column`, `map_row` FROM `locations` WHERE `id` = OLD.`location_id`;
END;
--> statement-breakpoint
CREATE TRIGGER `locations_mapped_on_update` AFTER UPDATE OF `latitude`, `longitude` ON `locations`
WHEN EXISTS (SELECT 1 FROM `restaurants` WHERE `location_id` = NEW.`id` AND `status` = 'approved') BEGIN
	INSERT INTO `map_cell_refreshes` (`column`, `row`) SELECT OLD.`map_column`, OLD.`map_row` UNION SELECT NEW.`map_column`, NEW.`map_row`;
END;
