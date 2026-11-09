import m0000 from './20261023083050_init/migration.sql';
import m0001 from './20261023175234_restaurant_browsing/migration.sql';
import m0002 from './20261023183038_history_id/migration.sql';
import m0003 from './20261023184653_notifications/migration.sql';
import m0004 from './20261027195821_suggestion_queue/migration.sql';
import m0005 from './20261104200248_city_search/migration.sql';
import m0006 from './20261104205600_city_search_log/migration.sql';
import m0007 from './20261105145334_private_profiles/migration.sql';
import m0008 from './20261109141655_user_review_stats/migration.sql';

  export default {
    migrations: {
      "20261023083050_init": m0000,
"20261023175234_restaurant_browsing": m0001,
"20261023183038_history_id": m0002,
"20261023184653_notifications": m0003,
"20261027195821_suggestion_queue": m0004,
"20261104200248_city_search": m0005,
"20261104205600_city_search_log": m0006,
"20261105145334_private_profiles": m0007,
"20261109141655_user_review_stats": m0008
}
  }
  