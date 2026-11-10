-- A CitySearch now approves the Restaurants it finds, and only those a User suggested wait for an Admin. The
-- Restaurants earlier searches entered and no Admin has decided on are approved. None of them has reviews, since
-- only an approved Restaurant is reviewed and none goes back to pending, so no cached stats change.
UPDATE `restaurants` SET `status` = 'approved' WHERE `status` = 'pending' AND `city_search_id` IS NOT NULL AND `suggested_by` IS NULL;
