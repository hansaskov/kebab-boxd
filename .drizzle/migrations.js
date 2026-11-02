import m0000 from './20261023083050_init/migration.sql';
import m0001 from './20261023175234_restaurant_browsing/migration.sql';
import m0002 from './20261023183038_history_id/migration.sql';
import m0003 from './20261023184653_notifications/migration.sql';
import m0004 from './20261027195821_suggestion_queue/migration.sql';

  export default {
    migrations: {
      "20261023083050_init": m0000,
"20261023175234_restaurant_browsing": m0001,
"20261023183038_history_id": m0002,
"20261023184653_notifications": m0003,
"20261027195821_suggestion_queue": m0004
}
  }
  